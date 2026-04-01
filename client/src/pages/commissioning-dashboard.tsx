/**
 * Commissioning Control Tower Dashboard
 *
 * Workbook-driven commissioning overview.
 * Shows status, blockers, completeness, source links, and sync state.
 * Does NOT duplicate detailed commissioning capture — links to source workbook instead.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { useAuth } from "@/hooks/use-auth";
import {
  RefreshCw,
  ExternalLink,
  FolderOpen,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Shield,
  Loader2,
  Upload,
} from "lucide-react";
import type {
  CommissioningDashboardPayload,
  CommissioningSection,
  CommissioningSectionItem,
} from "@shared/schema";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) h["X-CSRF-Token"] = csrf;
  return h;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  complete: { label: "Complete", color: "bg-green-100 text-green-800 border-green-300", icon: CheckCircle2 },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Clock },
  not_started: { label: "Not Started", color: "bg-gray-100 text-gray-600 border-gray-300", icon: Circle },
  blocked: { label: "Blocked", color: "bg-red-100 text-red-800 border-red-300", icon: XCircle },
  unknown: { label: "Unknown", color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: AlertTriangle },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color} text-xs gap-1`}>
      <Icon className="h-3 w-3" /> {config.label}
    </Badge>
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "\u2014";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return d;
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Section detail expansion */
function SectionCard({ section }: { section: CommissioningSection }) {
  const [expanded, setExpanded] = useState(false);
  const completedItems = section.items.filter(i => {
    const s = (i.status || "").toLowerCase();
    return s === "approved" || s === "complete" || s === "completed" || s === "done" || s === "passed";
  }).length;

  return (
    <Card className="overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <span className="font-medium text-sm">{section.sectionName}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {completedItems}/{section.items.length} items
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={section.displayStatus || "unknown"} />
          {section.approvedBy && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              by {section.approvedBy}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <CardContent className="border-t pt-3 pb-3 px-4 space-y-1">
          {section.items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No items found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 pr-3 font-medium">Description</th>
                    <th className="text-left py-1.5 pr-3 font-medium w-24">Status</th>
                    <th className="text-left py-1.5 pr-3 font-medium w-28 hidden sm:table-cell">Approved By</th>
                    <th className="text-left py-1.5 pr-3 font-medium w-24 hidden md:table-cell">Date</th>
                    <th className="text-left py-1.5 font-medium hidden lg:table-cell">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-1.5 pr-3">{item.description}</td>
                      <td className="py-1.5 pr-3">
                        {item.status ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {item.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">\u2014</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 hidden sm:table-cell">{item.approvedBy || "\u2014"}</td>
                      <td className="py-1.5 pr-3 hidden md:table-cell">{formatDate(item.date)}</td>
                      <td className="py-1.5 hidden lg:table-cell text-muted-foreground truncate max-w-[200px]">
                        {item.comments || "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {section.commentSummary && (
            <p className="text-xs text-muted-foreground mt-2 italic">{section.commentSummary}</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function CommissioningDashboardPage() {
  const [, params] = useRoute("/commissioning-dashboard/:projectId");
  const urlProjectId = params?.projectId ? parseInt(params.projectId) : undefined;

  const { projectsSummary, isLoading: projectsLoading } = useProjectsSummary();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(urlProjectId);
  const projectId = selectedProjectId;

  // Project options for selector
  const projectOptions = useMemo(() => {
    if (!projectsSummary) return [];
    return projectsSummary.map(p => ({
      value: String(p.id),
      label: p.projectName || `Project ${p.id}`,
    }));
  }, [projectsSummary]);

  // Main dashboard query
  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError } = useQuery<CommissioningDashboardPayload>({
    queryKey: ["commissioning-dashboard", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/commissioning-dashboard/${projectId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to load" }));
        throw new Error(err.error || "Failed to load commissioning dashboard");
      }
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  // Refresh mutation
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/commissioning-dashboard/${projectId}/refresh`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Refresh failed" }));
        throw new Error(err.error || "Refresh failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissioning-dashboard", projectId] });
    },
  });

  // File upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const res = await fetch(`/api/commissioning-dashboard/${projectId}/upload`, {
          method: "POST",
          headers: getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify({ fileBuffer: base64, fileName: file.name }),
        });
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: ["commissioning-dashboard", projectId] });
        }
      } catch (err) {
        console.error("Upload failed:", err);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Commissioning Control Tower
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Workbook-driven commissioning status and blockers
          </p>
        </div>
      </div>

      {/* Project Selector */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium shrink-0">Project:</label>
            <div className="w-full max-w-sm">
              <SearchableSelect
                options={projectOptions}
                value={projectId ? String(projectId) : ""}
                onValueChange={(val) => setSelectedProjectId(val ? parseInt(val) : undefined)}
                placeholder={projectsLoading ? "Loading projects..." : "Select a project"}
              />
            </div>

            {projectId && (
              <div className="flex items-center gap-2 ml-auto">
                {/* Manual upload fallback */}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".xlsx,.xlsm"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <span><Upload className="h-3.5 w-3.5" /> Upload</span>
                  </Button>
                </label>

                {/* Refresh from source */}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {dashboardLoading && projectId && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading commissioning data...
        </div>
      )}

      {/* Error state */}
      {dashboardError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            {dashboardError instanceof Error ? dashboardError.message : "Failed to load dashboard"}
          </CardContent>
        </Card>
      )}

      {/* No project selected */}
      {!projectId && !dashboardLoading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Select a project to view commissioning status</p>
          </CardContent>
        </Card>
      )}

      {/* Dashboard content */}
      {dashboard && !dashboardLoading && (
        <>
          {/* Project Header + Source Links */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold">{dashboard.projectName}</h2>
              <div className="flex items-center gap-3 mt-1">
                <StatusBadge status={dashboard.overallStatus} />
                <span className="text-sm text-muted-foreground">
                  {dashboard.completionPercent}% complete
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {dashboard.source?.workbookUrl && (
                <a
                  href={dashboard.source.workbookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs bg-green-50 border border-green-200 text-green-800 rounded-md px-3 py-1.5 hover:bg-green-100 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open Workbook
                </a>
              )}
              {dashboard.source?.folderUrl && (
                <a
                  href={dashboard.source.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-md px-3 py-1.5 hover:bg-blue-100 transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Shared Folder
                </a>
              )}
            </div>
          </div>

          {/* Overall Progress */}
          <Card>
            <CardContent className="py-4 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Overall Commissioning Progress</span>
                <span className="text-sm font-semibold">{dashboard.completionPercent}%</span>
              </div>
              <Progress value={dashboard.completionPercent} className="h-2" />
            </CardContent>
          </Card>

          {/* Sync State */}
          <Card className={dashboard.syncState.isStale ? "border-amber-200 bg-amber-50/50" : ""}>
            <CardContent className="py-3 px-4 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                {dashboard.syncState.isStale ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                )}
                <span>
                  Last refreshed: <strong>{timeAgo(dashboard.syncState.lastRefreshed)}</strong>
                </span>
                {dashboard.syncState.parseStatus && (
                  <Badge variant="outline" className="text-[10px]">
                    {dashboard.syncState.parseStatus}
                  </Badge>
                )}
              </div>
              {dashboard.syncState.parseMessage && (
                <span className="text-muted-foreground hidden sm:inline truncate max-w-xs">
                  {dashboard.syncState.parseMessage}
                </span>
              )}
            </CardContent>
          </Card>

          {/* No Source Configured */}
          {!dashboard.source && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-6 text-center">
                <FileSpreadsheet className="h-6 w-6 mx-auto mb-2 text-amber-600" />
                <p className="text-sm font-medium text-amber-800">No commissioning source configured</p>
                <p className="text-xs text-amber-700 mt-1">
                  Upload a workbook manually or configure a SharePoint source to enable automatic sync.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Blockers */}
          {dashboard.blockers.length > 0 && (
            <Card className="border-red-200 bg-red-50/50">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-red-800">
                  <XCircle className="h-4 w-4" /> Final Completion Blockers ({dashboard.blockers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-3 px-4">
                <ul className="space-y-1">
                  {dashboard.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {b}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* SSEG Status */}
          {Object.values(dashboard.ssegStatus).some(v => v) && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4" /> SSEG Status
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-3 px-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  {[
                    { label: "SSEG Application", value: dashboard.ssegStatus.application },
                    { label: "PTI", value: dashboard.ssegStatus.pti },
                    { label: "Commissioning Approval", value: dashboard.ssegStatus.commissioningApproval },
                    { label: "NERSA Registration", value: dashboard.ssegStatus.nersaRegistration },
                  ].filter(s => s.value).map((s, i) => (
                    <div key={i} className="rounded-md border p-2">
                      <div className="text-muted-foreground mb-0.5">{s.label}</div>
                      <div className="font-medium">{s.value}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section Cards */}
          {dashboard.sections.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Sections ({dashboard.sections.length})
              </h3>
              {dashboard.sections.map((section) => (
                <SectionCard key={section.sectionKey} section={section} />
              ))}
            </div>
          ) : (
            dashboard.source && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p className="text-sm">No commissioning sections parsed yet.</p>
                  <p className="text-xs mt-1">Click Refresh to parse the source workbook.</p>
                </CardContent>
              </Card>
            )
          )}

          {/* Section Summary Table */}
          {dashboard.sections.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Section Summary</CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-3 px-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-3 font-medium">Section</th>
                        <th className="text-left py-2 pr-3 font-medium">Status</th>
                        <th className="text-center py-2 pr-3 font-medium">Items</th>
                        <th className="text-left py-2 pr-3 font-medium hidden sm:table-cell">Approved By</th>
                        <th className="text-left py-2 font-medium hidden md:table-cell">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.sections.map((section) => {
                        const done = section.items.filter(i => {
                          const s = (i.status || "").toLowerCase();
                          return s === "approved" || s === "complete" || s === "completed" || s === "done" || s === "passed";
                        }).length;
                        return (
                          <tr key={section.sectionKey} className="border-b last:border-0">
                            <td className="py-2 pr-3 font-medium">{section.sectionName}</td>
                            <td className="py-2 pr-3">
                              <StatusBadge status={section.displayStatus || "unknown"} />
                            </td>
                            <td className="py-2 pr-3 text-center">{done}/{section.items.length}</td>
                            <td className="py-2 pr-3 hidden sm:table-cell">{section.approvedBy || "\u2014"}</td>
                            <td className="py-2 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">
                              {section.commentSummary || "\u2014"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

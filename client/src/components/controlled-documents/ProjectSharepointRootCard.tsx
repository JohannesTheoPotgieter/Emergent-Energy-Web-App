import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FolderTree, Save, Loader2, AlertCircle, CheckCircle2, Pencil, Sparkles, FolderOpen } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { isSuperAdmin } from "@/lib/access-control";
import { ApiError } from "@/lib/api-error";
import type { ProjectSharepointRoot } from "@shared/schema";

interface RootResponse {
  root: ProjectSharepointRoot | null;
}

interface ProjectSummaryLite {
  project_info_id?: number;
  projectInfoId?: number;
  project_name?: string;
  projectName?: string;
  client_name?: string | null;
  clientName?: string | null;
}

interface Props {
  projectId: number;
  /** When true, super-user edit form is hidden — useful on read-only contexts. */
  readOnly?: boolean;
}

/** Normalise a filesystem segment — strip trailing/leading slashes, whitespace. */
function sanitizeSegment(seg: string): string {
  return seg.trim().replace(/^[/\\]+|[/\\]+$/g, "").replace(/\s{2,}/g, " ");
}

/** Generate a handful of suggested root paths from project + client names. */
function buildSuggestions(projectName: string | null, clientName: string | null): string[] {
  const proj = sanitizeSegment(projectName || "");
  const client = sanitizeSegment(clientName || "");
  const out: string[] = [];
  if (client && proj) {
    out.push(`Sites/EngineeringSupport/Projects/${client}/${proj}`);
    out.push(`Projects/${client}/${proj}`);
    out.push(`Clients/${client}/${proj}`);
  }
  if (proj && !client) {
    out.push(`Sites/EngineeringSupport/Projects/${proj}`);
    out.push(`Projects/${proj}`);
  }
  return out;
}

/**
 * D5.3 — project SharePoint root config.
 *
 * Shows the current SharePoint root path for a project and, for super
 * users, an edit form. Real folder tree creation happens in D3.5 when
 * Graph integration is wired — today this is metadata only: set the
 * path string so the DocumentStrip + submit dialog know where to look.
 */
export function ProjectSharepointRootCard({ projectId, readOnly }: Props) {
  const qc = useQueryClient();
  const query = useQuery<RootResponse>({
    queryKey: [`/api/projects/${projectId}/sharepoint-root`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: projectId > 0,
  });

  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  const canEdit = !readOnly && isSuperAdmin(tokenRole, companyRole);

  const [editing, setEditing] = useState(false);
  const [rootPath, setRootPath] = useState("");
  const [driveId, setDriveId] = useState("");

  // Pull current project + client name for suggestion seeds, and recent
  // configured roots (from the cross-project projects-summary query) so
  // the user can reuse a sibling project's root pattern with one click.
  const projectsSummaryQuery = useQuery<ProjectSummaryLite[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: editing,
    staleTime: 120_000,
  });

  const thisProject = useMemo(() => {
    const list = projectsSummaryQuery.data ?? [];
    return list.find((p) => (p.project_info_id ?? p.projectInfoId) === projectId) ?? null;
  }, [projectsSummaryQuery.data, projectId]);

  const suggestions = useMemo(() => {
    return buildSuggestions(
      thisProject?.project_name ?? thisProject?.projectName ?? null,
      thisProject?.client_name ?? thisProject?.clientName ?? null,
    );
  }, [thisProject]);

  const cleanedPath = sanitizeSegment(rootPath);

  useEffect(() => {
    if (query.data?.root) {
      setRootPath(query.data.root.rootPath ?? "");
      setDriveId(query.data.root.driveId ?? "");
    }
  }, [query.data?.root]);

  const upsertMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}/sharepoint-root`, {
        rootPath: rootPath.trim(),
        driveId: driveId.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "SharePoint root updated." });
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/sharepoint-root`] });
      setEditing(false);
    },
    onError: (err) => {
      toast({
        title: "Save failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const root = query.data?.root ?? null;
  const hasRoot = !!root?.rootPath;

  return (
    <Card data-testid="project-sharepoint-root-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-primary" />
            SharePoint root
            {hasRoot ? (
              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                <AlertCircle className="h-3 w-3 mr-1" /> Not configured
              </Badge>
            )}
          </span>
          {canEdit && !editing && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="btn-edit-sharepoint-root">
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {query.isLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading…</p>
        ) : editing ? (
          <div className="space-y-3">
            {suggestions.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-primary" /> Suggested paths for this project
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setRootPath(s)}
                      className="px-2 py-1 rounded-md border text-[11px] font-mono bg-card hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
                      data-testid={`sharepoint-suggestion-${s}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Root path</Label>
              <Input
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="e.g. Sites/EngineeringSupport/Projects/Client/Project Name"
                className="font-mono text-xs"
                data-testid="input-root-path"
              />
              <p className="text-[11px] text-muted-foreground">
                Type or pick a suggestion above. The app appends document-type sub-folders + /Drafts, /Approved, /History automatically.
              </p>
            </div>

            {cleanedPath && (
              <div className="rounded-md border bg-[hsl(var(--surface-tint))]/60 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" /> Preview — folder tree that will be used
                </p>
                <pre className="text-[11px] font-mono text-foreground leading-relaxed whitespace-pre">
{`${cleanedPath}/
  ├── BD/Cost Proposal/Costing/
  │     ├── Drafts/
  │     ├── Approved/
  │     └── History/
  ├── BD/Cost Proposal/Design/...
  └── (13 document types — see Settings → Document types)`}
                </pre>
              </div>
            )}

            <details className="rounded-md border bg-muted/30 p-2 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">Advanced: Graph drive id</summary>
              <div className="pt-2 space-y-1">
                <Input
                  value={driveId}
                  onChange={(e) => setDriveId(e.target.value)}
                  placeholder="Drive id — populated automatically when Graph integration is wired"
                  className="font-mono text-xs"
                  data-testid="input-drive-id"
                />
                <p className="text-[10px] text-muted-foreground">
                  Leave blank. The real Graph integration populates this automatically when it lands.
                </p>
              </div>
            </details>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => upsertMut.mutate()}
                disabled={upsertMut.isPending || !rootPath.trim()}
                data-testid="btn-save-sharepoint-root"
              >
                {upsertMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setRootPath(root?.rootPath ?? "");
                  setDriveId(root?.driveId ?? "");
                }}
                disabled={upsertMut.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : hasRoot ? (
          <div className="space-y-1">
            <p className="text-xs font-mono break-all">{root!.rootPath}</p>
            {root!.driveId && <p className="text-[11px] text-muted-foreground font-mono">drive: {root!.driveId}</p>}
            {root!.configuredAt && (
              <p className="text-[11px] text-muted-foreground">
                Configured {new Date(root!.configuredAt).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              This project has no SharePoint root configured. Controlled documents can't be tracked until a super user sets one.
            </p>
            {!canEdit && (
              <p className="text-[11px] text-muted-foreground italic">Ask a COO or CEO admin to configure it.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

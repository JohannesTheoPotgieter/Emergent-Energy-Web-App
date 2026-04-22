import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FolderTree, Save, Loader2, AlertCircle, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { isSuperAdmin } from "@/lib/access-control";
import { ApiError } from "@/lib/api-error";
import type { ProjectSharepointRoot } from "@shared/schema";

interface RootResponse {
  root: ProjectSharepointRoot | null;
}

interface Props {
  projectId: number;
  /** When true, super-user edit form is hidden — useful on read-only contexts. */
  readOnly?: boolean;
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
          <div className="space-y-2">
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
                The app appends document-type folder-sub-paths and /Drafts, /Approved, /History under this root.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Graph drive id (optional)</Label>
              <Input
                value={driveId}
                onChange={(e) => setDriveId(e.target.value)}
                placeholder="Drive id — populated automatically when Graph integration is wired (D3.5)"
                className="font-mono text-xs"
                data-testid="input-drive-id"
              />
            </div>
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

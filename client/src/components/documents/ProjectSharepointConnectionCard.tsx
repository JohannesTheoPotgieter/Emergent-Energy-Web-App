/**
 * ProjectSharepointConnectionCard — the one-glance "is this project connected
 * to SharePoint?" surface.
 *
 * Reads the project's provisioned folder rows (project_folders) and renders a
 * single clear status banner:
 *   - Not connected   → no folders provisioned yet
 *   - Connected       → folders provisioned, no verify errors
 *   - Needs attention → one or more folders report a Graph verify error
 *
 * Inline actions (gated on documents_provision:create, server-enforced too):
 *   - Set up / Re-provision folders (idempotent; pick lifecycle mode)
 *   - Verify now (re-checks every linked folder still exists on Graph)
 *   - Open in SharePoint (deep-link to the project root folder)
 *
 * SharePoint stays the source of truth — this only ever touches folder
 * metadata + Graph references (driveId / itemId / webUrl), never file bytes.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, AlertTriangle, FolderTree, ExternalLink, Loader2, RefreshCw, FolderPlus,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import {
  useProjectFolders,
  useProvisionProjectFolders,
  useVerifyProjectFolders,
} from "@/hooks/use-document-management-admin";

/** The synthetic taxonomy key for the per-project container folder. */
const PROJECT_ROOT_KEY = "_project_root_";

type LifecycleMode = "pre_construction" | "full_lifecycle" | "both";

const LIFECYCLE_LABELS: Record<LifecycleMode, string> = {
  pre_construction: "Pre-construction folders",
  full_lifecycle: "Full-lifecycle folders",
  both: "All folders (pre-construction + full lifecycle)",
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 0) return "just now";
  if (diffMs < 60 * 1000) return "just now";
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / 60000)} min ago`;
  if (diffMs < day) return `${Math.floor(diffMs / 3600000)} h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ProjectSharepointConnectionCard({
  projectId,
}: {
  projectId: number;
}) {
  const folders = useProjectFolders(projectId);
  const provision = useProvisionProjectFolders();
  const verify = useVerifyProjectFolders();
  const { allowed: canProvision } = usePermission("documents_provision", "create");

  const [lifecycle, setLifecycle] = useState<LifecycleMode>("both");

  // What the selected lifecycle mode would create — so the user sees the
  // folder count before committing and never picks the wrong mode blind.
  const folderPreview = useQuery<{ mode: string; count: number; folders: { key: string; name: string }[] }>({
    queryKey: [`/api/projects/${projectId}/folder-preview?mode=${lifecycle}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: canProvision,
  });

  const status = useMemo(() => {
    const all = folders.data?.folders ?? [];
    const root = all.find((f) => f.taxonomyKey === PROJECT_ROOT_KEY) ?? null;
    const leafFolders = all.filter((f) => f.taxonomyKey !== PROJECT_ROOT_KEY);
    const provisioned = leafFolders.filter((f) => f.itemId).length;
    const notProvisioned = leafFolders.filter((f) => !f.itemId).length;
    const errors = all.filter((f) => f.verifyError).length;
    const firstError = all.find((f) => f.verifyError)?.verifyError ?? null;
    const lastVerifiedAt = all
      .map((f) => f.lastVerifiedAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;
    const openUrl = root?.webUrl ?? leafFolders.find((f) => f.webUrl)?.webUrl ?? null;
    const connected = provisioned > 0 || Boolean(root?.itemId);

    const kind: "not_connected" | "connected" | "attention" =
      errors > 0 ? "attention" : connected ? "connected" : "not_connected";

    return {
      kind,
      provisioned,
      notProvisioned,
      errors,
      firstError,
      lastVerifiedAt,
      openUrl,
      total: leafFolders.length,
    };
  }, [folders.data]);

  function runProvision() {
    provision.mutate(
      { projectId, lifecycleMode: lifecycle },
      {
        onSuccess: (res) => {
          const s = res.summary;
          const created = s.created + s.linkedExisting;
          toast({
            title: s.errors > 0 ? "Folders set up with some errors" : "SharePoint folders ready",
            description:
              `${created} created/linked · ${s.alreadyPresent} already there` +
              (s.errors > 0 ? ` · ${s.errors} error${s.errors === 1 ? "" : "s"}` : ""),
            variant: s.errors > 0 ? "destructive" : undefined,
          });
          // Auto-verify a clean provision so transient Graph failures surface
          // immediately instead of on the next manual "Verify now". Silent —
          // no extra toast; just refreshes the folder/verify state.
          if (s.errors === 0) {
            verify.mutate(projectId);
          }
        },
        onError: (err) => {
          toast({
            title: "Could not set up folders",
            description:
              err.message ||
              "Provisioning failed — set the Active Projects SharePoint root in Document Management → Provisioning first.",
            variant: "destructive",
          });
        },
      },
    );
  }

  function runVerify() {
    verify.mutate(projectId, {
      onSuccess: (res) => {
        toast({
          title: res.missing > 0 ? "Verify found problems" : "All folders verified",
          description:
            `${res.verified} folder${res.verified === 1 ? "" : "s"} OK` +
            (res.missing > 0 ? ` · ${res.missing} missing on SharePoint` : ""),
          variant: res.missing > 0 ? "destructive" : undefined,
        });
      },
      onError: (err) => {
        toast({
          title: "Verify failed",
          description: err.message || "Could not reach SharePoint to verify folders.",
          variant: "destructive",
        });
      },
    });
  }

  const busy = provision.isPending || verify.isPending;

  // Visual treatment per status.
  const tone =
    status.kind === "connected"
      ? { border: "border-emerald-200", bg: "bg-emerald-50/40", text: "text-emerald-800" }
      : status.kind === "attention"
        ? { border: "border-amber-300", bg: "bg-amber-50/50", text: "text-amber-900" }
        : { border: "border-muted", bg: "bg-muted/30", text: "text-foreground" };

  return (
    <Card className={`${tone.border} ${tone.bg}`} data-testid="project-sharepoint-connection-card">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <StatusIcon kind={status.kind} />
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${tone.text}`} data-testid="connection-headline">
                {status.kind === "connected" && "Connected to SharePoint"}
                {status.kind === "attention" && "Connected — some folders need attention"}
                {status.kind === "not_connected" && "Not connected to SharePoint"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5" data-testid="connection-detail">
                {folders.isLoading ? (
                  "Checking connection…"
                ) : status.kind === "not_connected" ? (
                  "Set up the project's SharePoint document folders to start tracking documents here."
                ) : (
                  <>
                    <span data-testid="connection-folder-count">
                      {status.provisioned} folder{status.provisioned === 1 ? "" : "s"} connected
                    </span>
                    {status.notProvisioned > 0 && (
                      <span className="text-amber-700"> · {status.notProvisioned} not set up</span>
                    )}
                    {status.errors > 0 && (
                      <span className="text-rose-700" data-testid="connection-error-count">
                        {" "}· {status.errors} need attention
                      </span>
                    )}
                    <span> · last verified {formatWhen(status.lastVerifiedAt)}</span>
                  </>
                )}
              </div>
              {status.kind === "attention" && status.firstError && (
                <div className="text-[11px] text-rose-700 mt-1 truncate" title={status.firstError}>
                  {status.firstError}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status.openUrl && (
              <a href={status.openUrl} target="_blank" rel="noreferrer" data-testid="btn-open-sharepoint">
                <Button size="sm" variant="outline" className="h-8">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open in SharePoint
                </Button>
              </a>
            )}

            {canProvision && status.kind !== "not_connected" && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={runVerify}
                disabled={busy}
                data-testid="btn-verify-folders"
              >
                {verify.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Verify now
              </Button>
            )}

            {canProvision && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as LifecycleMode)}>
                  <SelectTrigger className="h-8 w-[180px] text-xs" data-testid="select-lifecycle-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LIFECYCLE_LABELS) as LifecycleMode[]).map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">
                        {LIFECYCLE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={runProvision}
                  disabled={busy}
                  data-testid="btn-provision-folders"
                >
                  {provision.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : status.kind === "not_connected" ? (
                    <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {status.kind === "not_connected" ? "Set up folders" : "Re-provision"}
                </Button>
                </div>
                {folderPreview.data && (
                  <span
                    className="text-[10px] text-muted-foreground cursor-help"
                    title={folderPreview.data.folders.map((f) => f.name).join("\n")}
                    data-testid="folder-preview-hint"
                  >
                    Creates {folderPreview.data.count} folder{folderPreview.data.count === 1 ? "" : "s"} — hover to see the list
                  </span>
                )}
              </div>
            )}

            {!canProvision && status.kind === "not_connected" && (
              <Badge variant="outline" className="text-[10px]">
                A COO/admin needs to set up this project's folders
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ kind }: { kind: "not_connected" | "connected" | "attention" }) {
  if (kind === "connected") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />;
  }
  if (kind === "attention") {
    return <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />;
  }
  return <FolderTree className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />;
}

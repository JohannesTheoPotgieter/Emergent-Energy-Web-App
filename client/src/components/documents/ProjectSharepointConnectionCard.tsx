/**
 * ProjectSharepointConnectionCard — the one-glance "is this project connected
 * to SharePoint?" surface (browse-and-bind model).
 *
 * Reads the project's bound discipline folders (project_discipline_folders) and
 * renders a single clear status banner:
 *   - Not connected → no discipline folders bound yet
 *   - Connected     → one or more discipline folders bound
 *
 * Binding/unbinding lives in DisciplineFolderBinder (per discipline). This card
 * only summarises connection status and offers a deep-link into the first bound
 * SharePoint folder.
 *
 * SharePoint stays the source of truth — this only ever reads folder metadata +
 * Graph references (driveId / itemId / webUrl), never file bytes.
 */

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, FolderTree, ExternalLink,
} from "lucide-react";
import { useDisciplineFolders } from "@/hooks/use-discipline-folders";

export function ProjectSharepointConnectionCard({
  projectId,
}: {
  projectId: number;
}) {
  const folders = useDisciplineFolders(projectId);

  const status = useMemo(() => {
    const all = folders.data?.folders ?? [];
    const bound = all.length;
    const openUrl = all.find((f) => f.webUrl)?.webUrl ?? null;
    const connected = bound > 0;
    return {
      kind: (connected ? "connected" : "not_connected") as "connected" | "not_connected",
      bound,
      openUrl,
    };
  }, [folders.data]);

  const tone =
    status.kind === "connected"
      ? { border: "border-emerald-200", bg: "bg-emerald-50/40", text: "text-emerald-800" }
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
                {status.kind === "not_connected" && "Not connected to SharePoint"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5" data-testid="connection-detail">
                {folders.isLoading ? (
                  "Checking connection…"
                ) : status.kind === "not_connected" ? (
                  "Bind a SharePoint folder per discipline below to start tracking documents here."
                ) : (
                  <span data-testid="connection-folder-count">
                    {status.bound} discipline folder{status.bound === 1 ? "" : "s"} bound
                  </span>
                )}
              </div>
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
            {status.kind === "not_connected" && !folders.isLoading && (
              <Badge variant="outline" className="text-[10px]">
                Use the binder below to connect this project's folders
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ kind }: { kind: "not_connected" | "connected" }) {
  if (kind === "connected") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />;
  }
  return <FolderTree className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />;
}

/**
 * SyncBadge — shows import freshness (green/amber/red) for a project.
 * A read-only indicator that appears on project detail pages.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchQueryFn } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ImportFreshnessResponse {
  projectId: number;
  lastImportAt: string | null;
  daysSinceImport: number | null;
  isStale: boolean;
}

function syncColour(days: number | null, isStale: boolean): "green" | "amber" | "red" {
  if (days === null || isStale) return "red";
  if (days <= 7) return "green";
  if (days <= 14) return "amber";
  return "red";
}

function syncTooltip(days: number | null, colour: "green" | "amber" | "red"): string {
  if (colour === "green") return "Tracker data is up to date";
  if (colour === "amber") return `Tracker data is ${days} days old — consider re-importing`;
  return "Tracker data is over 14 days old";
}

/** Shows how fresh the last Smart Import run was for this project. */
export function SyncBadge({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery<ImportFreshnessResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/import-freshness`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/import-freshness`),
    enabled: Number.isFinite(projectId) && projectId > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground" aria-label="Loading import status">
        Sync…
      </Badge>
    );
  }

  const colour = syncColour(data.daysSinceImport, data.isStale);
  const tooltipText = syncTooltip(data.daysSinceImport, colour);

  const badgeClass =
    colour === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
      : colour === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-50"
        : "bg-red-50 text-red-700 border-red-300 hover:bg-red-50";

  const label = colour === "green" ? "Up to date" : colour === "amber" ? `${data.daysSinceImport}d old` : "Stale";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`text-[10px] cursor-default ${badgeClass}`}
            tabIndex={0}
            role="status"
            aria-label={tooltipText}
          >
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs max-w-xs">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


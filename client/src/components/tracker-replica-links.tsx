/**
 * TrackerReplicaLinks — CTA card linking to the per-project Tracker replica
 * screens and showing a "Tracker last synced" freshness badge.
 *
 * The freshness badge is visible to all Execution roles (gated at
 * work_items:view on the server). A stale badge (>7 days) renders amber;
 * never-imported renders red. This gives every Execution user an immediate
 * signal that tracker data may be outdated without navigating away.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Calendar, History, ExternalLink, RefreshCw, AlertTriangle, GitMerge } from "lucide-react";

interface Props {
  projectId: number | null | undefined;
  /** Optional override — defaults to a row layout. */
  layout?: "row" | "column";
}

interface DriftCountResponse {
  projectId: number;
  unverified: number;
  verified: number;
  bySection: {
    PLAN:        { unverified: number; verified: number };
    REVENUE:     { unverified: number; verified: number };
    EXPENDITURE: { unverified: number; verified: number };
  };
}

interface ImportFreshnessResponse {
  projectId: number;
  lastImportAt: string | null;
  daysSinceImport: number | null;
  isStale: boolean;
}

const LINKS = [
  { path: "revenue-tracking",       label: "Revenue Tracking",       icon: TrendingUp,   tone: "text-emerald-700" },
  { path: "expenditure-breakdown",  label: "Expenditure Breakdown",  icon: TrendingDown, tone: "text-amber-700" },
  { path: "program-plan",           label: "Program Plan",           icon: Calendar,     tone: "text-sky-700" },
  { path: "manual-overrides",       label: "Manual Edit Log",        icon: History,      tone: "text-slate-600" },
] as const;

function DriftBadge({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery<DriftCountResponse>({
    queryKey: ["/api/tracker-replica", projectId, "drift-count"],
    queryFn: async () => {
      const res = await fetch(`/api/tracker-replica/${projectId}/drift-count`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load drift count");
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading || !data) return null;
  if (data.unverified === 0) return null;

  return (
    <Link
      href={`/projects/${projectId}/excel-vs-app`}
      data-testid="drift-badge"
      className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-[10px] font-medium text-orange-700 hover:bg-orange-100 transition-colors"
      title={`${data.unverified} unresolved drift field${data.unverified === 1 ? "" : "s"} — click to review on the Excel-vs-App diff page`}
    >
      <GitMerge className="h-3 w-3" />
      {data.unverified} unresolved drift
    </Link>
  );
}

function SyncBadge({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery<ImportFreshnessResponse>({
    queryKey: ["/api/tracker-replica", projectId, "import-freshness"],
    queryFn: async () => {
      const res = await fetch(`/api/tracker-replica/${projectId}/import-freshness`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load import freshness");
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Checking sync…
      </span>
    );
  }

  if (!data || data.lastImportAt === null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-medium text-red-700"
        title="This project has no committed Smart Import. Tracker data may be missing."
        data-testid="sync-badge-never"
      >
        <AlertTriangle className="h-3 w-3" />
        Never imported
      </span>
    );
  }

  const days = data.daysSinceImport ?? 0;
  const label = days === 0
    ? "Synced today"
    : days === 1
    ? "Synced yesterday"
    : `Synced ${days}d ago`;

  if (data.isStale) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700"
        title={`Tracker was last synced ${days} days ago. Ask Management to re-import the tracker.`}
        data-testid="sync-badge-stale"
      >
        <AlertTriangle className="h-3 w-3" />
        {label}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
      title={`Tracker data is current (last synced ${days === 0 ? "today" : `${days}d ago`}).`}
      data-testid="sync-badge-fresh"
    >
      <RefreshCw className="h-3 w-3" />
      {label}
    </span>
  );
}

export function TrackerReplicaLinks({ projectId, layout = "row" }: Props) {
  if (!projectId || !Number.isFinite(projectId)) return null;

  const containerClass = layout === "row"
    ? "flex flex-wrap gap-2"
    : "flex flex-col gap-2";

  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs font-semibold text-emerald-900">
            Tracker Replica (per-project, 1:1 with the source workbook)
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DriftBadge projectId={projectId} />
            <SyncBadge projectId={projectId} />
          </div>
        </div>
        <div className={containerClass}>
          {LINKS.map(({ path, label, icon: Icon, tone }) => (
            <Link
              key={path}
              href={`/projects/${projectId}/${path}`}
              data-testid={`tracker-replica-link-${path}`}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
            >
              <Icon className={`h-3.5 w-3.5 ${tone}`} />
              {label}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

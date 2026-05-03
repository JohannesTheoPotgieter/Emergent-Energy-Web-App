/**
 * TrackerReplicaLinks — small CTA card that links a viewer to the
 * three per-project Tracker replica screens added in the 2026-04-29
 * release.
 *
 * Drop this anywhere a `projectId` is in scope. Renders nothing when
 * `projectId` is not numeric (e.g. portfolio-level pages with no
 * selection). Read-only navigation; does not fetch any data itself.
 */
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Calendar, History, ExternalLink } from "lucide-react";

interface Props {
  projectId: number | null | undefined;
  /** Optional override — defaults to a vertical 4-row grid. */
  layout?: "row" | "column";
}

const LINKS = [
  { path: "revenue-tracking",       label: "Revenue Tracking",       icon: TrendingUp,   tone: "text-emerald-700" },
  { path: "expenditure-breakdown",  label: "Expenditure Breakdown",  icon: TrendingDown, tone: "text-amber-700" },
  { path: "program-plan",           label: "Program Plan",           icon: Calendar,     tone: "text-sky-700" },
  { path: "manual-overrides",       label: "Manual Edit Log",        icon: History,      tone: "text-slate-600" },
] as const;

export function TrackerReplicaLinks({ projectId, layout = "row" }: Props) {
  if (!projectId || !Number.isFinite(projectId)) return null;

  const containerClass = layout === "row"
    ? "flex flex-wrap gap-2"
    : "flex flex-col gap-2";

  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardContent className="p-3 space-y-2">
        <div className="text-xs font-semibold text-emerald-900">Tracker Replica (per-project, 1:1 with the source workbook)</div>
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

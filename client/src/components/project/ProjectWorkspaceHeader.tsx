/**
 * ProjectWorkspaceHeader — Wave 1 Step 2
 *
 * Shared project identity header for all project-scoped department pages.
 * Reads from existing v2 API endpoints — no new backend required.
 *
 * Shows: project name, phase badge, PM/PD, client, key dates, health indicators.
 * Read-only in Wave 1. Write capabilities added in Wave 2.
 */

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Activity, AlertCircle, Calendar, CheckCircle, Clock, User, Zap,
} from "lucide-react";
import { useProjectDetail } from "@/hooks/use-project-v2";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";

interface ProjectWorkspaceHeaderProps {
  projectId: number;
  /** Compact mode for embedding in tight layouts */
  compact?: boolean;
}

const PHASE_BADGE_COLORS: Record<string, string> = {
  P0_FIRST_ASSESSMENT: "bg-muted text-foreground",
  P1_COST_PROPOSAL_DESIGN: "bg-violet-100 text-violet-700",
  P2_PD_PM_HANDOVER: "bg-indigo-100 text-indigo-700",
  P3_DETAILED_DESIGN_PROC_RELEASE: "bg-blue-100 text-blue-700",
  P4_CONSTRUCTION_INSTALLATION: "bg-amber-100 text-amber-700",
  P5_COMMISSIONING_TESTING: "bg-orange-100 text-orange-700",
  P6_HANDOVER_CLIENT_MATRIARCH: "bg-teal-100 text-teal-700",
  P7_CLOSEOUT_POSTMORTEM: "bg-emerald-100 text-emerald-700",
};

const RAG_COLORS: Record<string, { bg: string; icon: typeof CheckCircle }> = {
  GREEN: { bg: "text-emerald-600", icon: CheckCircle },
  AMBER: { bg: "text-amber-600", icon: AlertCircle },
  RED: { bg: "text-red-600", icon: AlertCircle },
};

function formatCurrency(value: string | null): string {
  if (!value) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return "—";
  return `R${(num / 1_000_000).toFixed(2)}M`;
}

function formatKwp(value: string | null): string {
  if (!value) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return "—";
  return `${num.toFixed(0)} kWp`;
}

export function ProjectWorkspaceHeader({ projectId, compact = false }: ProjectWorkspaceHeaderProps) {
  const { data, isLoading, isError } = useProjectDetail(projectId);

  const phaseLabel = useMemo(() => {
    const phase = data?.executionState?.phase;
    if (!phase) return "Unknown";
    return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
  }, [data?.executionState?.phase]);

  const phaseBadgeColor = useMemo(() => {
    const phase = data?.executionState?.phase;
    if (!phase) return "bg-muted text-foreground";
    return PHASE_BADGE_COLORS[phase] || "bg-muted text-foreground";
  }, [data?.executionState?.phase]);

  const ragInfo = useMemo(() => {
    const rag = data?.executionState?.ragStatus;
    if (!rag) return null;
    return RAG_COLORS[rag] || null;
  }, [data?.executionState?.ragStatus]);

  if (isLoading) {
    return (
      <Card className="mb-4">
        <CardContent className={cn("flex items-center gap-4", compact ? "py-3" : "py-4")}>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return null; // Graceful fallback — don't break the page
  }

  const { project, executionState } = data;

  if (compact) {
    return (
      <div className="flex items-center gap-3 px-2 py-2 border-b bg-card text-card-foreground">
        <h2 className="font-semibold text-sm truncate">{project.projectName}</h2>
        <Badge className={cn("text-xs shrink-0", phaseBadgeColor)}>{phaseLabel}</Badge>
        {ragInfo && (
          <ragInfo.icon className={cn("h-4 w-4 shrink-0", ragInfo.bg)} />
        )}
        {project.sizeKwp && (
          <span className="text-xs text-muted-foreground shrink-0">
            <Zap className="h-3 w-3 inline mr-0.5" />
            {formatKwp(project.sizeKwp)}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card className="mb-4">
      <CardContent className="py-4">
        {/* Row 1: Name + Phase + RAG */}
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-lg font-semibold truncate">{project.projectName}</h1>
          <Badge className={cn("shrink-0", phaseBadgeColor)}>{phaseLabel}</Badge>
          {ragInfo && (
            <ragInfo.icon className={cn("h-5 w-5 shrink-0", ragInfo.bg)} />
          )}
          {executionState.escalationLevel && executionState.escalationLevel !== "NONE" && (
            <Badge variant="destructive" className="text-xs shrink-0">
              Escalated: {executionState.escalationLevel}
            </Badge>
          )}
        </div>

        {/* Row 2: Key info chips */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {project.pm && (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              PM: <span className="text-foreground font-medium">{project.pm}</span>
            </span>
          )}
          {project.pd && (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              PD: <span className="text-foreground font-medium">{project.pd}</span>
            </span>
          )}
          {project.sizeKwp && (
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              {formatKwp(project.sizeKwp)}
            </span>
          )}
          {project.contractValue && (
            <span className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" />
              {formatCurrency(project.contractValue)}
            </span>
          )}
          {executionState.signedStatus === "signed" && executionState.signedDate && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Signed: {executionState.signedDate}
            </span>
          )}
          {!executionState.isActive && (
            <Badge variant="secondary" className="text-xs">
              {executionState.archivedStatus || "Inactive"}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

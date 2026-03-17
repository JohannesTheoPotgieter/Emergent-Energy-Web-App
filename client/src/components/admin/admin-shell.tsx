import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ADMIN_SURFACES,
  type AdminSurfaceId,
  type AdminSurfaceMeta,
  getAdminSurfaceMeta,
} from "@/config/admin-surfaces";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type AdminStatusBadge = {
  label: string;
  tone?: StatusTone;
};

type AdminShellMetric = {
  label: string;
  value: ReactNode;
  helper?: string;
};

function mapToneToStatus(tone: StatusTone = "neutral") {
  if (tone === "danger") return "error" as const;
  return tone;
}

function SurfaceLinkCard({
  surface,
  active,
}: {
  surface: AdminSurfaceMeta;
  active: boolean;
}) {
  const Icon = surface.icon;

  return (
    <Link
      href={surface.path}
      className={cn(
        "group rounded-xl border p-3 transition-colors",
        active
          ? "border-primary/25 bg-primary/8 shadow-[var(--shadow-xs)]"
          : "border-border/80 bg-background/90 hover:border-primary/20 hover:bg-background",
      )}
      data-testid={`admin-surface-${surface.id}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 rounded-lg p-2",
            active ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className={cn("text-sm font-medium", active ? "text-foreground" : "text-foreground/90")}>
            {surface.label}
          </p>
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{surface.description}</p>
        </div>
      </div>
    </Link>
  );
}

export function AdminPageShell({
  surfaceId,
  title,
  description,
  statuses,
  metrics,
  actions,
  children,
}: {
  surfaceId: AdminSurfaceId;
  title?: string;
  description?: string;
  statuses?: AdminStatusBadge[];
  metrics?: AdminShellMetric[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const surface = getAdminSurfaceMeta(surfaceId);

  if (!surface) {
    return <PageShell>{children}</PageShell>;
  }

  const Icon = surface.icon;

  return (
    <PageShell className="space-y-5">
      <div className="rounded-2xl border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,249,247,0.96))] p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <div className="space-y-4">
          <SectionHeader
            icon={<Icon className="h-4 w-4" />}
            title={title || surface.label}
            description={description || surface.description}
            actions={actions}
          />

          {statuses && statuses.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {statuses.map((status) => (
                <StatusChip key={status.label} status={mapToneToStatus(status.tone)} dot>
                  {status.label}
                </StatusChip>
              ))}
            </div>
          ) : null}

          {metrics && metrics.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <Card key={metric.label} className="border-border/70 bg-background/90 shadow-none">
                  <CardContent className="space-y-1 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                    <div className="text-xl font-semibold tracking-tight text-foreground">{metric.value}</div>
                    {metric.helper ? <p className="text-xs text-muted-foreground">{metric.helper}</p> : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {children}
    </PageShell>
  );
}

export function AdminQueryState({
  isLoading,
  error,
  onRetry,
  empty,
  emptyTitle = "No data available",
  emptyDescription,
  loadingLabel = "Loading...",
  children,
}: {
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  loadingLabel?: string;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-1">
              <p className="font-medium text-red-800">This admin panel could not load.</p>
              <p className="text-red-700">{error}</p>
            </div>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-red-200 bg-white text-red-700 hover:bg-red-100"
                onClick={onRetry}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/35 p-4 text-sm">
        <p className="font-medium text-foreground">{emptyTitle}</p>
        {emptyDescription ? <p className="mt-1 text-muted-foreground">{emptyDescription}</p> : null}
      </div>
    );
  }

  return <>{children}</>;
}

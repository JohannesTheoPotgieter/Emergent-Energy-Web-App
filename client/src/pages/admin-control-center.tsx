import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { StageDefinitionsCard } from "@/components/admin/stage-definitions-card";
import { GateConfigCard } from "@/components/admin/gate-config-card";
import { AdminPageShell } from "@/components/admin/admin-shell";
import { CcSystemHealthCard } from "@/components/admin/cc-system-health-card";
import { CcImportGovernanceCard } from "@/components/admin/cc-import-governance-card";
import { CcIntegrationCard } from "@/components/admin/cc-integration-card";
import { CcFeatureFlagsCard } from "@/components/admin/cc-feature-flags-card";
import { CcActiveSessionsCard } from "@/components/admin/cc-active-sessions-card";
import { CcDangerousActionsCard } from "@/components/admin/cc-dangerous-actions-card";
import { CcOperationalExceptions } from "@/components/admin/cc-operational-exceptions";
import { CcRecentEvents } from "@/components/admin/cc-recent-events";
import type { HealthData, ImportGovernanceData, IntegrationHealthItem } from "@/components/admin/cc-types";
import { Link } from "wouter";
import { ADMIN_SURFACES } from "@/config/admin-surfaces";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/layout/page-shell";
import { LayoutGrid } from "lucide-react";

export default function AdminControlCenterPage() {
  // These queries are also used by child components — React Query deduplicates them
  const healthQuery = useAdminFetch<HealthData>(
    "/api/admin/control-center/health",
    ["admin-control-health"],
  );
  const importGovernanceQuery = useAdminFetch<ImportGovernanceData>(
    "/api/admin/control-center/import-governance",
    ["admin-control-import-governance"],
  );
  const integrationHealthQuery = useAdminFetch<IntegrationHealthItem[]>(
    "/api/admin/control-center/integration-health",
    ["admin-control-integration-health"],
  );

  const health = healthQuery.data;
  const governance = importGovernanceQuery.data;
  const integrationItems = integrationHealthQuery.data ?? [];
  const connectedCount = integrationItems.filter((i) => i.status === "connected").length;

  const shellStatuses = [
    health?.db.connected
      ? { label: "Database connected", tone: "success" as const }
      : { label: "Database needs attention", tone: "danger" as const },
    (governance?.summary.reviewBacklog ?? 0) > 0
      ? { label: `${governance!.summary.reviewBacklog} imports awaiting review`, tone: "warning" as const }
      : { label: "Import review backlog clear", tone: "success" as const },
    connectedCount > 0
      ? { label: `${connectedCount}/3 Microsoft surfaces connected`, tone: connectedCount === 3 ? "success" as const : "warning" as const }
      : { label: "Microsoft connectivity needs attention", tone: "danger" as const },
  ];

  return (
    <AdminPageShell
      surfaceId="control-center"
      title="Control Center"
      description="Operational cockpit for system governance, import health, and Microsoft integration visibility."
      statuses={shellStatuses}
      metrics={[
        { label: "Active Projects", value: health?.projects.active ?? "—", helper: "Projects currently marked active" },
        { label: "Import Backlog", value: governance?.summary.reviewBacklog ?? "—", helper: "Preview and review runs awaiting action" },
        { label: "Pending Excel", value: governance?.summary.pendingExcelConfirmations ?? "—", helper: "Tracker confirmations still outstanding" },
        { label: "Microsoft Sync", value: `${connectedCount}/3`, helper: "Outlook, SharePoint, Teams connectivity" },
      ]}
    >
      <div className="space-y-6" data-testid="admin-control-center">
        {/* Row 1: Health overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <CcSystemHealthCard />
          <CcImportGovernanceCard />
          <CcIntegrationCard />
        </div>

        {/* Stage Engine Configuration (Prompt 6) */}
        <StageDefinitionsCard />
        <GateConfigCard />

        {/* Operational exceptions */}
        <CcOperationalExceptions />

        {/* Feature flags */}
        <CcFeatureFlagsCard />

        {/* Active sessions */}
        <CcActiveSessionsCard />

        {/* Recent events (import failures + system issues) */}
        <CcRecentEvents />

        {/* Dangerous actions */}
        <CcDangerousActionsCard />

        {/* All Admin Tools — full reachability hub for admins.
            Every admin surface in the app is linked here so no admin-only
            page requires URL typing. New surfaces added to ADMIN_SURFACES
            appear here automatically. */}
        <div className="rounded-2xl border border-border/80 bg-background/95 p-4 shadow-[var(--shadow-xs)] sm:p-5">
          <SectionHeader
            icon={<LayoutGrid className="h-4 w-4" />}
            title="All Admin Tools"
            description="Every admin surface in the platform — use this hub to reach tools that aren't pinned to the sidebar."
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="admin-tools-grid">
            {ADMIN_SURFACES.map((surface) => {
              const Icon = surface.icon;
              return (
                <Link
                  key={surface.id}
                  href={surface.path}
                  data-testid={`admin-tool-link-${surface.id}`}
                  className="group block"
                >
                  <Card className="h-full border-border/70 bg-background/95 transition-colors hover:border-primary/30 hover:bg-primary/5">
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-foreground">{surface.label}</p>
                        <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{surface.description}</p>
                        <p className="font-mono text-[10px] text-muted-foreground/70">{surface.path}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </AdminPageShell>
  );
}

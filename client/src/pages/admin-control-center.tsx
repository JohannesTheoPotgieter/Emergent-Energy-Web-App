import { useAdminFetch } from "@/hooks/use-admin-fetch";
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
      </div>
    </AdminPageShell>
  );
}

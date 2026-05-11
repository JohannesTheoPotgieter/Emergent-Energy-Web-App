/**
 * Integration Statuses — single page showing live health for every external
 * connector the app depends on (Outlook / SharePoint / Teams via MS Graph,
 * QuickBooks, Pipedrive). Reuses the existing ConnectionsSection from the
 * legacy role-settings page so there is one source of truth for the panels
 * and the underlying /api/admin/control-center/integration-health contract.
 */

import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { ConnectionsSection } from "./role-settings";

export default function AdminIntegrationsPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Integration Statuses"
        subtitle="Live connection state for Outlook, SharePoint, Teams, QuickBooks and Pipedrive. Use the cards to reconnect, refresh tokens, or jump to per-integration admin."
      />
      <ConnectionsSection />
    </PageLayout>
  );
}

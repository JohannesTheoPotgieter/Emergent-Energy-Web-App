/**
 * Functionality Control — COO/CEO surface that enables or disables individual
 * screens (and, with route gating, makes disabled screens 404 even via direct
 * URL). Promoted from the legacy /admin/settings tabbed page so the four-item
 * Settings nav (Roles & Permissions · Functionality Control · Integration
 * Statuses · Audit Log) can land on a dedicated page each.
 *
 * Backend: GET/PUT /api/admin/screen-settings (admin-screen-settings.routes.ts).
 * Hook: client/src/hooks/use-screen-availability.ts (consumed by ProtectedRoute).
 */

import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { ScreensSection } from "./admin-settings/screens/screens-section";

export default function AdminFunctionalityPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Functionality Control"
        subtitle="Switch any screen on or off for the whole company. Disabled screens disappear from the sidebar and return Not Found if visited directly. COO and CEO only."
      />
      <ScreensSection />
    </PageLayout>
  );
}

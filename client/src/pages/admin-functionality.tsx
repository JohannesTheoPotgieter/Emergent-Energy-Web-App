/**
 * Functionality Control — COO/CEO surface that enables or disables individual
 * screens (and, with route gating, makes disabled screens 404 even via direct
 * URL). Promoted out of the legacy /admin/settings tabbed page onto its own
 * route. NOTE: removed from the Settings menu on 2026-06-18 (screen gating
 * defaults to open), so it is no longer one of the three Settings sub-sections
 * (Roles & Permissions · Integration Statuses · Audit Log). This page stays
 * live and is reachable directly at /admin/functionality.
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

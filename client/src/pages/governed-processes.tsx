/**
 * Governed Processes Page — Wave 3
 *
 * Standalone page for viewing all governed processes across projects.
 * Also embeddable within department dashboards.
 */

import { PageShell } from "@/components/layout/page-shell";
import { GovernedProcessList } from "@/components/governed-process/GovernedProcessList";

export default function GovernedProcessesPage() {
  return (
    <PageShell className="p-3 md:p-4">
      <GovernedProcessList title="All Governed Processes" showCreateButton={false} />
    </PageShell>
  );
}

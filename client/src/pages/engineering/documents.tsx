/**
 * Engineering Document Management — engineering team's working surface for
 * drawings, specs, NCR evidence, calibration certs, and approval traffic.
 *
 * Layout: ApprovalQueueCard sits ABOVE the canonical /documents browser so
 * engineering approvals waiting on you are the first thing you see when
 * you land on this tab. The full SharePoint browser (Active Clients + the
 * generic library) lives below.
 *
 * Data integrity:
 * - All documents live in SharePoint. The app holds metadata + Graph
 *   driveId/driveItemId references via managed_documents + folder_taxonomy
 *   + project_folders (controlled_documents is deprecated — do not extend
 *   it). See AGENT_GUARDRAILS.md § 2 (Six Rules — SharePoint = source of
 *   truth) and § 5A (no file bodies in DB).
 * - The approvals queue is canonical — it reads
 *   /api/managed-document-approvals/queue under the hood. Only the
 *   component's folder name (controlled-documents/) is legacy; a rename
 *   is queued as a separate follow-up.
 */

import { ApprovalQueueCard } from "@/components/controlled-documents";
import DocumentsPage from "../documents";

export default function EngineeringDocumentsPage() {
  return (
    <div className="ee-page space-y-6" data-testid="engineering-documents-page">
      <ApprovalQueueCard />
      <DocumentsPage />
    </div>
  );
}

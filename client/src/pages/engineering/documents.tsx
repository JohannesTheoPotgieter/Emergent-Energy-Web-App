/**
 * Engineering Document Management — engineering team's working surface for
 * drawings, specs, NCR evidence, calibration certs, and approval traffic.
 *
 * Layout: ManagedDocumentApprovalQueue sits above the canonical /documents
 * browser so engineering approvals waiting on you are the first thing you
 * see when you land on this tab.
 *
 * Data integrity:
 * - All documents live in SharePoint. The app holds metadata + Graph
 *   driveId/driveItemId references via managed_documents + folder_taxonomy
 *   + project_folders (controlled_documents is deprecated — do not extend
 *   it). See AGENT_GUARDRAILS.md § 2 (Six Rules — SharePoint = source of
 *   truth) and § 5A (no file bodies in DB).
 * - The approvals queue is the D6 Phase 5 canonical component
 *   `ManagedDocumentApprovalQueue`, reading the typed nested response from
 *   /api/managed-document-approvals/queue. The legacy ApprovalQueueCard
 *   under client/src/components/managed-documents/ had a shape mismatch
 *   with the API and is being retired.
 */

import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import DocumentsPage from "../documents";

export default function EngineeringDocumentsPage() {
  return (
    <div className="space-y-6" data-testid="engineering-documents-page">
      <ManagedDocumentApprovalQueue title="Engineering approvals waiting on me" />
      <DocumentsPage />
    </div>
  );
}

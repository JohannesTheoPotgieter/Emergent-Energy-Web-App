/**
 * Engineering Document Management — engineering team's working surface for
 * drawings, specs, NCR evidence, calibration certs, and approval traffic.
 *
 * Layout: a standard PageShell + SectionHeader frames the page with explicit
 * engineering context, then the ManagedDocumentApprovalQueue (approvals
 * waiting on you) sits above the canonical /documents browser.
 *
 * Data integrity:
 * - All documents live in SharePoint. The app holds metadata + Graph
 *   driveId/driveItemId references via managed_documents + folder_taxonomy
 *   + project_folders (controlled_documents is deprecated — do not extend
 *   it). See AGENT_GUARDRAILS.md § 2 (Six Rules — SharePoint = source of
 *   truth) and § 5A (no file bodies in DB).
 * - The approvals queue is the D6 Phase 5 canonical component
 *   `ManagedDocumentApprovalQueue`, reading the typed nested response from
 *   /api/managed-document-approvals/queue. It owns its own
 *   loading / empty / error states.
 */

import { FolderTree } from "lucide-react";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import DocumentsPage from "../documents";

export default function EngineeringDocumentsPage() {
  return (
    <PageShell className="p-4 md:p-6 space-y-6" data-testid="engineering-documents-page">
      <SectionHeader
        icon={<FolderTree className="h-5 w-5" />}
        eyebrow="Engineering"
        title="Engineering Document Management"
        description="Drawings, specs, NCR evidence and calibration certificates. Approvals waiting on you appear first; the full SharePoint-backed browser is below."
      />
      <ManagedDocumentApprovalQueue title="Engineering approvals waiting on me" />
      <DocumentsPage />
    </PageShell>
  );
}

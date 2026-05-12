/**
 * Quality Document Management — quality team's working surface for NCR
 * evidence, audit reports, calibration certs, ITP sign-offs, and commissioning
 * packs.
 *
 * Layout mirrors Engineering Document Management: ApprovalQueueCard above
 * the canonical SharePoint browser, so quality approvals waiting on you are
 * the first thing you see.
 *
 * Data integrity: same backbone as Engineering — managed_documents +
 * folder_taxonomy + project_folders, SharePoint = source of truth, no file
 * bodies in the DB. See AGENT_GUARDRAILS.md § 2 + § 5A.
 */

import { ApprovalQueueCard } from "@/components/controlled-documents";
import DocumentsPage from "../documents";

export default function QualityDocumentsPage() {
  return (
    <div className="ee-page space-y-6" data-testid="quality-documents-page">
      <ApprovalQueueCard />
      <DocumentsPage />
    </div>
  );
}

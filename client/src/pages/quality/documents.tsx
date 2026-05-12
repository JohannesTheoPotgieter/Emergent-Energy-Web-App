/**
 * Quality Document Management — wraps the canonical /documents browser so
 * NCR evidence, audit reports, calibration certs, IRR sign-offs and
 * commissioning packs live under the Quality tab. Same managed_documents +
 * folder_taxonomy backbone as Engineering Documents (single SharePoint
 * source of truth).
 */

import DocumentsPage from "../documents";

export default function QualityDocumentsPage() {
  return <DocumentsPage />;
}

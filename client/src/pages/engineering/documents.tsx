/**
 * Engineering Document Management — wraps the canonical /documents browser
 * so engineering folders, drawings, specs, NCR evidence and approval traffic
 * live under one Engineering tab. Document storage stays on SharePoint;
 * managed_documents + folder_taxonomy + project_folders are the canonical
 * tables (controlled_documents is deprecated — do not extend it).
 *
 * Note: this is intentionally a wrapper — there is exactly one
 * SharePoint-backed document UI in the app and we want a single source of
 * truth for upload / browse / version / comment behaviour. Filters and
 * scoping happen inside `DocumentsPage` based on the user's folder picks.
 */

import DocumentsPage from "../documents";

export default function EngineeringDocumentsPage() {
  return <DocumentsPage />;
}

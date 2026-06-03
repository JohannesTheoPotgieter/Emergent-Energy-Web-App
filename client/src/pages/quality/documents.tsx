/**
 * Quality Document Management — quality team's working surface for NCR
 * evidence, audit reports, calibration certs, ITP sign-offs, and commissioning
 * packs.
 *
 * Layout mirrors Engineering Document Management: ManagedDocumentApprovalQueue
 * above the canonical SharePoint browser, so quality approvals waiting on you
 * are the first thing you see.
 *
 * Data integrity: same backbone as Engineering — managed_documents +
 * folder_taxonomy + project_folders, SharePoint = source of truth, no file
 * bodies in the DB. See AGENT_GUARDRAILS.md § 2 + § 5A.
 *
 * UX (audit QM-5): the page now carries a standard PageShell + SectionHeader
 * so quality has a titled surface, and the header explicitly names the three
 * evidence-integrity signals (version, approval status, owner) that the
 * managed-document strips below surface per document — these are the trust
 * signals NCR/ITP evidence is judged on.
 */

import { ShieldCheck } from "lucide-react";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { DisciplineProjectDocuments } from "@/components/documents/DisciplineProjectDocuments";

export default function QualityDocumentsPage() {
  return (
    <PageShell className="space-y-6" data-testid="quality-documents-page">
      <SectionHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Quality Documents"
        description="NCR evidence, ITP sign-offs, audit reports, calibration certs, and commissioning packs. Approvals waiting on you appear first; pick a project to see its quality folders and SharePoint connection."
      />
      <ManagedDocumentApprovalQueue title="Quality approvals waiting on me" />
      <DisciplineProjectDocuments discipline="QUALITY" />
    </PageShell>
  );
}

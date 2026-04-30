# Document Management v2 — Trust Matrix

Date: 2026-04-30  
Status: bridge-mode trust map (v1 + v2 coexisting)

## Scope and assumptions
- SharePoint remains source of truth for document bodies and folder reality.
- Legacy and bridge flows stay live until parity evidence exists.
- Trust ratings below are operational ratings, not architecture intent.

## Trust matrix

| Route | Page / function | Source of truth | Permission entity | Role access (high level) | SharePoint dependency | Sync / failure mode | Trust status | Next action |
|---|---|---|---|---|---|---|---|---|
| `/documents` + `/api/documents/*` | Generic SharePoint browser (roots, children, download, upload, folder create, rename, revisions/comments/checkout) | SharePoint for files + app metadata mirrors (`managed_documents`) | `documents` (+ admin/provision actions should map to `documents_admin` / `documents_provision`) | Broad cross-functional view; elevated roles for mutating actions | Hard dependency for file/folder operations and metadata refresh | Graph outage/degraded auth blocks live browse/write; app metadata may lag until retry | **Conditional** | Keep “bridge/in progress” labelling; add explicit route-level permission mapping for provision/admin mutators; add parity checks vs legacy flows |
| `/projects/:projectId/documents` + `/api/projects/:id/controlled-documents*` | Project controlled documents strip + approval queue | SharePoint paths/roots + `controlled_documents` lifecycle metadata | `documents` (with approval/provision controls expected via admin/provision entities) | Project/delivery stakeholders can view; approvals limited by role matrix | Medium-high dependency (submit/approve path references SharePoint path + root config) | Missing root or Graph failures block submit/approval operations while legacy remains available | **Conditional** | Preserve existing submit/approve/reject/recall; add COO/delegate provisioning checklist evidence |
| `/admin/document-types` + controlled-doc type admin APIs | Taxonomy + approval requirements admin | App DB (`folder_taxonomy`, `document_approval_requirements`) with SharePoint path semantics | `documents_admin` | Admin-only (COO/CEO class roles) | Indirect dependency (defines naming/requirements consumed by SharePoint-backed flows) | Taxonomy drift causes wrong folder/approval expectations but should not break legacy browsing | **Conditional** | Keep taxonomy admin-editable; forbid hardcoded folder names in new flows; add taxonomy provenance checks |
| `/api/projects/:id/sharepoint-root` and root repositories | Project SharePoint root configuration | App DB (`project_sharepoint_roots`, `company_sharepoint_roots`) as config mirror of SharePoint structure | `documents_provision` / `documents_admin` | Provisioning/admin roles only for write; broader read as needed | Hard dependency (misconfigured roots break bridge operations) | Missing/incorrect roots produce soft failure (warnings, no hard lifecycle gate) | **Conditional** | Explicitly enforce COO-triggered/delegated provisioning workflow and audit trail |
| Legacy controlled-document lifecycle paths (existing v1) | Existing production submit/approve flows | Existing DB + SharePoint-linked metadata | Existing entity mapping | Existing production role matrix | Existing integration footprint | Existing known failure behavior remains understood/operational | **Trusted (current production baseline)** | Keep live and usable until v2 parity + rollback runbook are proven |
| v2-only paths without parity evidence (future expansion) | Any net-new document management behavior not yet dual-run validated | Intended: SharePoint + additive v2 tables | Should be `documents*` entities | TBD by explicit permission map | Usually high | Unknown under incident conditions until validated | **Unsafe / Not reviewed** | Do not position as authoritative; run pilot parity and failure-mode drills before trust elevation |

## Bridge to v2 migration path
1. Keep v1 and bridge surfaces active with explicit user-facing labels.
2. Maintain SharePoint as source-of-truth language in UI and runbooks.
3. Gate provisioning to COO-triggered/delegated process with soft checklist enforcement.
4. Add automated guards for:
   - document permission entities existing in registry,
   - no destructive migration statements against legacy/bridge document tables.
5. Promote trust status only after parity evidence exists for read/write and incident recovery.

## Evidence references (current repo)
- Guardrail baseline doc: `docs/overhaul/document-management-v2-guardrails.md`
- SharePoint browser page (`/documents`) bridge label.
- Project controlled-documents page (`/projects/:projectId/documents`).
- Document route surfaces in:
  - `server/routes/document-management.routes.ts`
  - `server/routes/documents.routes.ts`
- Permission entities in registry: `documents`, `documents_provision`, `documents_admin`.

# Document Management v2 — Guardrails (PR #742 follow-up)

Date: 2026-04-30  
Status: additive bridge (not cutover)

## Old flow status (must stay live)
- Existing controlled-document submit/approve/reject/recall flow remains the active production flow.
- Existing SharePoint browser flow (`/documents`) remains active and usable.
- Existing stage/lifecycle and approval flows are unchanged.

## New schema status
- v2 document tables are treated as additive only in this phase:
  - `controlled_documents`
  - `managed_documents`
  - `project_sharepoint_roots`
  - `folder_taxonomy`
  - `project_folders`
  - `document_approval_requirements`
- No table drops or destructive schema actions are allowed before full replacement is proven.

## Guardrails
1. Project remains the primary spine for document ownership and lookup.
2. SharePoint remains source-of-truth for document bodies and folder reality.
3. Provisioning is COO-triggered or delegated; automation must not bypass this governance.
4. Enforcement remains soft during bridge phase (warnings/checklists), not hard stage gates.
5. Folder names must come from admin-editable taxonomy (no hardwired names in new behavior).
6. Legacy document flows stay available until v2 parity is verified in production.

## Migration path (additive)
1. **Dual visibility:** keep old + v2 surfaces visible with clear “in progress” labels.
2. **Permission parity:** include `documents`, `documents_provision`, `documents_admin` in permission snapshots.
3. **Read parity checks:** compare legacy and v2 read outputs on pilot projects.
4. **Write pilot:** restrict v2 write/provision actions to COO-admin path first.
5. **Cutover readiness:** only after parity, audit evidence, and rollback runbook exist.
6. **Decommission plan:** remove legacy only in a dedicated, approved PR after sign-off.

## Next PR scope (proposed)
- Wire `documents`, `documents_provision`, and `documents_admin` entities into route-level permission checks where document APIs are mounted.
- Add document-domain parity checks (legacy vs v2) to automated test coverage.
- Add explicit COO/delegate provisioning checklist UI tied to taxonomy configuration.

## Risks / deferred
- Route-level permission wiring for new document entities is still pending.
- Full parity harness for Graph-backed paths is pending.
- Taxonomy/provision governance UX needs final COO workflow confirmation.

# Source of Truth Matrix (Excel Migration State)

This matrix codifies ownership while Excel remains upstream for mastered domains.

## Ownership classes

- **EXCEL_MASTERED**: App can capture proposed changes, but Excel/import reconciliation remains upstream truth.
- **APP_MASTERED**: App is authoritative system of record.
- **HYBRID_GOVERNED**: Requires explicit conflict-aware governance and acknowledgement workflow.

## Domain matrix

| Domain / field group | Ownership class | Operational rule |
| --- | --- | --- |
| Project master identity/client/phase/RAG baseline fields | EXCEL_MASTERED | App writes are treated as governed source update requests + audit trail, not silent canonical override. |
| Project plan baseline and schedule import rows | EXCEL_MASTERED | Import snapshots drive baseline; unresolved conflicts remain explicit blockers. |
| Program expense / cost lines | EXCEL_MASTERED | Import lineage is preserved; manual overrides remain visible and reconcilable. |
| Revenue milestones / inflows | EXCEL_MASTERED | App cannot silently suppress Excel-origin mismatch evidence. |
| Finance summary materializations | HYBRID_GOVERNED | Derived from imported rows plus explicit app overrides with audit entries. |
| PM on-the-go actions | APP_MASTERED | Operational execution records remain app-owned, with optional links to source update requests when applicable. |
| Approvals | APP_MASTERED | Approval lifecycle and assignee decisions are app-governed. |
| Comments / collaboration notes | APP_MASTERED | Collaboration content is app-owned, auditable, and never overwritten by import. |
| Audit / notifications | APP_MASTERED | App is source for actor/action lineage. |
| Document lifecycle metadata | HYBRID_GOVERNED | Document operational state is app-owned, but source-linked provenance remains visible when tied to imports. |
| Governance acknowledgements | HYBRID_GOVERNED | Ack gaps are explicit readiness blockers; no auto-completion allowed. |

## Enforcement implemented in this hardening pass

- Project master update route classifies incoming fields and records ownership class in audit payload.
- Governance preview request creation is now constrained to updates that touch **EXCEL_MASTERED** project-info fields.
- Imports sync-state endpoint reports per-project stale/conflicted/ack-waiting/reimport-waiting status for operational visibility.

# Backend Target Truth Matrix (Consolidation Pass)

| Domain | Target tables | Transitional tables | Legacy tables | API v2 read | API v2 write | Frontend direct dependency | Migration status | Notes |
|---|---|---|---|---|---|---|---|---|
| Projects | `project_info` | imported tracker mirrors | `projects` and old flat summaries | yes | yes | yes (via v2 API only) | in-progress | `projectId` is canonical relationship key. |
| Lifecycle / phase history | `project_phase_history` (+ `project_info.phase`) | `normalized_execution_phases` (derived/supporting) | ad-hoc phase fields in legacy tables | yes | yes | no | in-progress | handover transition updates both current phase and history in one transaction. |
| Work planning / execution tasks | `work_items` | task adapters/integration feeds | old `tasks` family | yes | yes | no | in-progress | `work_items` is operational task spine for v2. |
| Engineering staged workflow | `project_eng_stages`, `project_eng_tasks`, `project_eng_deliverables`, `project_eng_approvals` | imported engineering trackers | legacy engineering snapshot tables | yes | yes | no | in-progress | v2 engineering designs route uses `project_eng_deliverables` only. |
| Quality management | `qc_checklist`, `qc_item_instance`, `qc_template*` | seeded templates | quality widgets coupled to legacy tasks | yes | yes | no | in-progress | create/patch checks enforce checklist belongs to same project. |
| Procurement | `procurement_items` | PO projection within procurement rows | legacy procurement trackers | yes | yes | no | in-progress | generic procurement kept distinct from PO flow. |
| Invoice capture | `invoice_captures` | reconciliation links to procurement/cost lines | legacy invoice ledgers | yes | yes | no | in-progress | v2 invoices route targets capture table only. |
| Financial normalized lines | `normalized_revenue_lines`, `normalized_cost_lines`, `normalized_execution_phases` | import run snapshots | tracker import raw sheets | yes | no (except variation workflow in work items) | no | in-progress | finance detail endpoints are distinct (`cashflow/cos/revenue/expenditure`). |
| Imports | `smart_import_runs` (+ domain import artifacts) | import queue records | old one-off import logs | yes | controlled | no | in-progress | import domain routes remain read-oriented in v2. |
| Approvals | `project_eng_approvals` and approval flags in target domain tables | approvals wrappers | old generic approvals endpoints | partial | partial | no | transitional | maintain compatibility wrappers until full domain-cutover. |
| Audit | `audit_events` (+ `change_sets`, `field_changes` where active) | older activity log adapters | legacy event logs | yes | yes | no | in-progress | all v2 mutations audited with domain entity/action. |
| Roles / permissions | `permission-catalog` in code (authoritative), optional DB overlays | `role_permissions` dynamic override cache | ad-hoc per-route maps | yes | controlled | no | in-progress | v2 unified through single policy + permission catalog source. |
| Portfolios | `portfolios`, `project_portfolio_assignments` | rollout planning tables | legacy portfolio summaries | no | no | no | pending | not yet cut over to v2 routes in this pass. |
| Deliverables | engineering deliverables: `project_eng_deliverables`; general execution evidence remains `work_items` attachments/notes | old deliverable adapters | legacy deliverable tables | yes (engineering) | yes (engineering) | no | in-progress | avoid mixing engineering deliverables with generic task docs. |
| PD tickets / intake | `project_info` PD fields + intake connectors/tables | intake templates/connectors | old PD tracker rows | yes (project development view) | yes (handover + work items) | no | in-progress | keep legacy intake endpoints isolated for migration. |

## Classification Rules

- **Target**: authoritative, used by all new API v2 reads/writes in the domain.
- **Transitional**: tolerated only for migration, derivation, or temporary compatibility.
- **Legacy**: no new v2 logic; only existing legacy endpoints until cutover complete.
- **Import/raw only**: import artifacts and raw tracker-shape records are never source-of-truth for v2 mutations.
- **Admin/support only**: operational control tables used by admins, not business-source tables.
- **Deprecated**: endpoint/table wrappers retained solely for controlled removal.

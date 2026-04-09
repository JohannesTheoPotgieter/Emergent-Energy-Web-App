# Canonical Model Decision Table

| Domain | Canonical table(s) | Read APIs | Write APIs | Legacy status |
|---|---|---|---|---|
| Project master | `project_info` | `/api/projects`, `/api/project/:projectName` | Project create/update routes | Legacy duplicates in module-specific project snapshots should become read-only adapters |
| Work item / task master | `work_items`, `work_item_assignments`, `work_item_dependencies` | `/api/my-work/*`, `/api/engineering/tasks`, `/api/execution-board` (through adapter) | Work-item write endpoints + adapters from legacy task routes | `operational_tasks`, `mytool_tasks`, `normalized_plan_tasks` are transitional sources |
| Milestone state | `program_inflows` (financial milestone truth) + normalized work-item milestone rows | `/api/revenue*`, `/api/cashflow`, milestone views in project detail | Milestone create/convert/link routes write canonical milestone rows first | Historical milestone copies in import tables are read-only after ingestion |
| Revenue lines | `normalized_revenue_lines` | Revenue tracker + cashflow APIs | Finance writeback endpoints | `program_inflows` derived columns remain compatibility outputs |
| Cost / expenditure lines | `normalized_cost_lines`, `program_expense` (legacy ingest) | COS / GP / procurement APIs | Procurement + finance write endpoints | `program_expense` remains ingest source, not authoritative edit surface |
| Deliverables | `project_eng_deliverables` | Deliverable capture + project engineering views | Deliverable capture + approval actions | No parallel deliverable masters allowed outside canonical table |
| Approvals | `approvals` and domain-specific approval status columns (`project_eng_deliverables.approval_status`, etc.) | `/api/approvals*`, admin approvals pages | Approval action endpoints only | Ad-hoc boolean flags in unrelated tables should be deprecated |
| Portfolio | `portfolios`, `portfolio_projects` | `/api/portfolios*` | Portfolio management routes | Any embedded project grouping fields are derived only |

## Decision rules

1. **One write-master per domain.** Any other module table is adapter/read model only.
2. **Write APIs validate canonical state first** (permission, current state, conflict checks), then project to legacy read models if needed.
3. **Legacy tables are transitional** and should be tagged as `adapter` or `deprecated` in code comments and route docs.

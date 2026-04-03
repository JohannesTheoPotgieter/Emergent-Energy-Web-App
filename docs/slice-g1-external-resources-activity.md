# Slice G.1: External Resources + Activity/Audit Logs

> **Status:** Implemented  
> **Predecessor:** Phase A (parties, user_accounts), Phase B (project_instances), Phase E (deliverable_instances)  
> **Principle:** Additive, non-breaking, one narrow slice

---

## Design

### External Resources (Unified File Registry)

`core.external_resources` consolidates all SharePoint file references into one table. Files live on SharePoint via OneDrive (linked through the user's work Microsoft account).

| Source Table | resource_type | Rows (est.) |
|---|---|---|
| `sp_files` | `sharepoint_file` | ~5,000 |
| `deliverable_files` | `deliverable_file` | ~1,000 |
| `sp_file_pointers` | `file_pointer` | ~2,000 |

### Resource Links (Many-to-Many Junction)

`core.resource_links` enables a single file to be linked to multiple entities (deliverables, work items, projects). Unique on (resource_id, entity_type, entity_id).

### Activity Log (Operational Events)

`core.activity_log` captures day-to-day operational events — "user moved project to next stage", "deliverable status changed", etc.

| Source Table | Rows (est.) |
|---|---|
| `domain_events` | ~10,000 |
| `deliverable_events` | ~3,000 |

### Audit Log (Compliance Events)

`core.audit_log` preserves compliance/governance records long-term — before/after change snapshots, actor identification, IP addresses, correlation IDs.

| Source Table | Rows (est.) |
|---|---|
| `audit_events` | ~50,000 |
| `audit_trail` | ~20,000 |

---

## Scope In / Out

- [x] DDL: external_resources + resource_links
- [x] DDL: activity_log + audit_log
- [x] Backfill: 3 file sources + entity link creation
- [x] Backfill: domain_events + deliverable_events → activity_log
- [x] Backfill: audit_events + audit_trail → audit_log
- [x] Party resolution for uploaders and actors
- [x] Safety warnings, idempotency, rollbacks
- Scope out: No Drizzle ORM, no app code changes, legacy tables untouched

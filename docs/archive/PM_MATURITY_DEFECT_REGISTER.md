# PM Maturity Defect Register — V1.2

## Known Issues

| # | Severity | Feature | Description | Status | Workaround |
|---|----------|---------|-------------|--------|------------|
| 1 | Low | RAID | Cross-project rollup endpoint not yet implemented | Deferred to V1.3 | Use project-level RAID tabs individually |
| 2 | Low | Dependencies | CPM recalculation not triggered on dependency create/update | Deferred to V1.3 | Schedule dates managed manually |
| 3 | Low | Procurement | Auto-linking to PO Generator not implemented | Deferred to V1.3 | Create PO manually and enter reference |
| 4 | Low | Commissioning | Attachment/document upload not integrated | Deferred to V1.3 | Use evidence notes field |
| 5 | Info | PM OTG | Approvals review card uses basic approve/reject without comment field | Enhancement for V1.3 | Use desktop for detailed review |

## Resolved During Development

| # | Feature | Description | Resolution |
|---|---------|-------------|------------|
| 1 | Approvals | General approval type not rendered in ProjectApprovalsTab | Added fallback: `TYPE_CONFIG[item.type] \|\| TYPE_CONFIG.general` |
| 2 | Admin Approvals | Missing "general" type in typeConfig caused render errors | Added general type config entry |
| 3 | Approvals | Approve/reject mutations didn't handle general approval IDs | Added `gen-` prefix detection with routing to PATCH endpoint |

## Regression Testing
- All V1.1 security hardening features verified intact
- Permission enforcement count increased (new routes all have `requirePermission`)
- Existing tabs (Quality, Engineering, Finance, etc.) unaffected
- Login page version taglines updated

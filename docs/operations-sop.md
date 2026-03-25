# Operations SOP

## Daily / regular checks
- Monitor import success/failure events.
- Review critical audit events and permission failures.
- Check dashboard/reporting freshness where materializations are used.

## Change management SOP
1. Define change scope and affected modules.
2. Validate role/permission impact.
3. Run migration and schema checks.
4. Execute QA gate checks.
5. Release with rollback path defined.

## Incident response (high-level)
- Triage impact (data, access, reporting, integrations).
- Contain by disabling affected feature flags/paths where possible.
- Recover canonical data path first.
- Document root cause and follow-up actions in post-incident notes.

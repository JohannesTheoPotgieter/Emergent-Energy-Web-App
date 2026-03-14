# Release Gate Definition (Blocking Rules)

A release is **blocked** unless all required checks pass with auditable evidence.

## Mandatory commands

```bash
npm run reconciliation:report
npm run release:gate
```

## Exact release blockers

Release must be blocked when any of the following is true:

1. **Failing API tests**
   - Command: `npm run test:api`
   - Block condition: non-zero exit code.

2. **Failing smoke tests**
   - Command: `npm run test:smoke`
   - Block condition: non-zero exit code.

3. **Failing routes tests**
   - Command: `npm run test:routes`
   - Block condition: non-zero exit code.

4. **Failing workflow tests**
   - Command: `npm run test:workflows` (or override via `WORKFLOW_TEST_COMMAND`).
   - Block condition: non-zero exit code.

5. **Reconciliation proof missing or unstable**
   - Evidence file: `qa/reports/reconciliation-status.json` (or `RELEASE_RECONCILIATION_FILE`).
   - Block condition: status is `fail` or `warning`, or evidence file is missing/invalid.

6. **Critical route role proof missing**
   - Evidence file: `docs/qa/results/latest/role-permission-audit.md` (or `ROLE_AUDIT_FILE`).
   - Critical routes: `/projects`, `/project/:projectName`, `/cashflow`, `/quality`, `/engineering/tasks`, `/pm-dashboard`, `/admin/control-center`, `/handover-control`.
   - Block condition: audit file missing, or any critical route lacks a `Pass` validation entry.

7. **Critical defect file required and missing/failing**
   - Evidence file: `FINAL_DEFECT_REGISTER.md` (or `CRITICAL_DEFECT_FILE`).
   - If `REQUIRE_CRITICAL_DEFECT_FILE=true`: gate blocks when file is missing, unreadable, or has any open `Critical`, `High`, `P0`, `P1`, or `Severity 1` defect.
   - If unset/false: missing file becomes a warning with manual signoff, but open critical/high defects still fail.

## Generated evidence

`npm run release:gate` writes:

- `qa/reports/release-gate-result.json`

The command exits non-zero when release is blocked.

## Environment overrides

- `WORKFLOW_TEST_COMMAND`
- `RELEASE_RECONCILIATION_FILE`
- `CRITICAL_DEFECT_FILE`
- `REQUIRE_CRITICAL_DEFECT_FILE`
- `ROLE_AUDIT_FILE`

## Policy

No production release may be approved from intuition alone; proof artifacts above are required.
Warnings are explicit and inspectable, and all required proof checks fail closed.

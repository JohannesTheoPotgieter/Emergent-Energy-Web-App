# Documentation Index

Start with the root [`README.md`](../README.md) (quick start) and
[`HANDOVER.md`](../HANDOVER.md) (new-maintainer onboarding). This index maps the
rest by topic. Anything under [`archive/`](./archive/) is historical — retained
for traceability, not for day-to-day work.

## Getting started
- [Developer setup & testing](./dev-setup.md)
- [Deploy & rollback runbook](./runbooks/deploy-and-rollback.md)
- [Microsoft 365 integrations](./microsoft-integrations.md)

## Architecture & rules (canonical)
- [AGENT_GUARDRAILS.md](./AGENT_GUARDRAILS.md) — the load-bearing rules doc
  (schema, RBAC, migrations, finance, integrations). Read first.
- [architecture.md](./architecture.md) — architecture baseline
- [operating-model/playbook-v2.0.md](./operating-model/playbook-v2.0.md) —
  the C&I Solar Delivery Playbook (product/process canon)
- [overhaul/01-design-system.md](./overhaul/01-design-system.md) — design system

## Finance (🔒 FROZEN)
- [finance-source-of-truth-audit.md](./finance-source-of-truth-audit.md) —
  Part I is the single locked source of finance rules. **Do not re-litigate.**
- [finance-freeze-runbook.md](./finance-freeze-runbook.md) — break-glass procedures
- [finance-reconciliation.md](./finance-reconciliation.md) — QB matcher / reconciliation
- [data-import-and-source-of-truth.md](./data-import-and-source-of-truth.md)

## Smart Import v2
- [smart-import-v2-spec.md](./smart-import-v2-spec.md) — canonical spec
- [smart-import-v2-operator-guide.md](./smart-import-v2-operator-guide.md)
- [smart-import-v2-known-limitations.md](./smart-import-v2-known-limitations.md)
- [smart-import-v2-test-matrix.md](./smart-import-v2-test-matrix.md)

## Roles, permissions & operations
- [permissions.md](./permissions.md) · [roles-and-permissions.md](./roles-and-permissions.md)
- [operations-sop.md](./operations-sop.md)
- [security-data-encryption.md](./security-data-encryption.md) (POPIA / at-rest encryption)
- [parked-features.md](./parked-features.md) — deliberately-deferred surfaces

## Document management
- [overhaul/document-management-v2-guardrails.md](./overhaul/document-management-v2-guardrails.md)
- [overhaul/document-management-v2-trust-matrix.md](./overhaul/document-management-v2-trust-matrix.md)

## Runbooks (executable procedures)
- [deploy-and-rollback.md](./runbooks/deploy-and-rollback.md)
- [secrets-rotation.md](./runbooks/secrets-rotation.md) (+ `secrets-rotation-history.md`)
- [dev-data-refresh.md](./runbooks/dev-data-refresh.md)
- [excel-vs-app.md](./runbooks/excel-vs-app.md)

## Operator library & reporting reference
- [ops-library/](./ops-library/) — operator-grade guides (operations authority)
- [reporting.md](./reporting.md)

## Historical reference
- [Documentation archive](./archive/) — dated audits, superseded plans,
  completed working papers, and one-off runbook reports.

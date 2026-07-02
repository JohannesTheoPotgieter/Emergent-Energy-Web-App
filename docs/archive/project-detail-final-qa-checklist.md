# Project Detail Final QA Checklist

Date: 2026-05-21

## Files changed

- `client/src/pages/project-detail.tsx`
- `client/src/components/ProjectCommandHeader.tsx`
- `client/src/components/project/ProjectCommandCentre.tsx`
- `client/src/components/project/ProjectWorkflowSections.tsx`
- `client/src/components/tabs/ProjectEngineeringTasksTab.tsx`
- `client/src/hooks/use-project-v2.ts`
- `client/src/lib/project-detail-navigation.ts`
- `client/src/lib/project-detail-command-centre.ts`
- `shared/api-types/project-v2.ts`
- `server/api/v2/repositories/project-v2-repository.ts`
- `server/api/v2/services/project-v2-service.ts`
- `docs/project-detail-source-of-truth-map.md`
- `docs/superpowers/plans/2026-05-21-project-detail-command-page.md`
- `qa/fixtures/file-size-baseline.json`
- `qa/tests/project-detail-command-centre.test.ts`
- `qa/tests/project-detail-command-surface.test.ts`
- `qa/tests/unit/project-command-header-render.test.tsx`
- `qa/tests/project-v2-service-regression.test.ts`
- `qa/tests/unit/project-detail-hook-contract.test.ts`

## Endpoints touched

- `GET /api/v2/projects/:projectId`
- Project V2 repository lookup for latest committed Smart Import run.

No finance import, revenue, COS, cashflow, QuickBooks, SharePoint, or Pipedrive route was rewritten.

## Business rules preserved

- Excel tracker values remain source of truth where imported.
- Project Detail displays import lineage instead of replacing Excel authority.
- COS realised remains tied to invoice actuals; the command centre does not introduce a new COS formula.
- Payment/receipt date logic remains in the finance endpoints and tracker components.
- Invoice-without-PO remains a red-flag procurement/finance control issue.
- SharePoint is shown as the document source of truth.
- Pipedrive remains the CRM/opportunity pipeline authority.
- Hold/Blocked is displayed as project status, not lifecycle stage.
- Stage movement controls remain evidence-gated in the lifecycle workflow.

## Tests added or updated

- Route/deep-link and permission-gated workflow tests.
- Command-centre helper tests for strict finance rows, source authority badges, and exception priority.
- Header render test for import lineage and finance masking.
- V2 service regression tests for import lineage.
- Project Detail hook contract updated for command-centre default routing.

## Manual QA steps

- Open `/project/id/:projectId?dept=overview` and verify the command centre renders.
- Confirm workflow navigation order: Overview, PM Delivery, Finance / Commercial, Engineering, Quality, Procurement, Documents / SharePoint, History / Decisions, Excel Replica.
- Confirm restricted departments are hidden from nav.
- Open a restricted direct link and verify the no-permission state.
- Switch from Overview to Documents and confirm the SharePoint authority message appears.
- Switch to Finance and confirm Procurement is no longer duplicated as a finance subtab.
- Open Excel Replica and verify import lineage/source markers remain visible.
- Check mobile/tablet layouts for wrapping and clipped table content.
- Verify browser console has no relevant runtime errors.

## Risks and deferred items

- Per-row and per-field import lineage is still limited by available import metadata.
- Excel replica tabs still need workbook-by-workbook visual parity review.
- Commitment and invoice detail should be strengthened with canonical PO/invoice endpoint fields where available.
- Full lifecycle stage transition enforcement still needs a server-side evidence workflow audit.
- Full test suite has unrelated pre-existing failures outside this Project Detail work.

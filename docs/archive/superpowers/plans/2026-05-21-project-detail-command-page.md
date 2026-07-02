# Project Detail Command Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Project Detail into a source-of-truth command page with clear workflow grouping, import lineage, strict finance states, and permission-safe navigation.

**Architecture:** Keep existing finance/import routes intact, add small client-side helpers for navigation and command-centre summaries, and render new workflow departments from existing tab components. V2 Project Detail carries project-level Smart Import lineage from the repository/service layer.

**Tech Stack:** React, Wouter, TanStack Query, TypeScript, Drizzle, Vitest, Playwright smoke validation.

---

### Task 1: Navigation And Route Authority

**Files:**
- Modify: `client/src/lib/project-detail-navigation.ts`
- Modify: `client/src/pages/project-detail.tsx`
- Test: `qa/tests/project-detail-command-surface.test.ts`

- [x] Add first-class workflow departments: Overview, PM, Finance, Engineering, Quality, Procurement, Documents, History, Excel.
- [x] Keep legacy route aliases but redirect them to the new `dept` / `sub` model.
- [x] Hide restricted departments from navigation.
- [x] Preserve direct restricted links with a clear no-permission state.

### Task 2: Source Authority And Finance Summary Helpers

**Files:**
- Create: `client/src/lib/project-detail-command-centre.ts`
- Test: `qa/tests/project-detail-command-centre.test.ts`

- [x] Build strict finance rows without introducing new finance formulas.
- [x] Build compact source authority badges for Excel, App, QuickBooks, SharePoint, and Pipedrive.
- [x] Prioritise command-centre exceptions above routine status.

### Task 3: Command Centre UI

**Files:**
- Create: `client/src/components/project/ProjectCommandCentre.tsx`
- Modify: `client/src/pages/project-detail.tsx`

- [x] Render Overview as the default command-centre surface.
- [x] Surface operating state, exceptions, source authority, finance control states, and document/lifecycle governance notes.
- [x] Keep procurement, documents, and history as separate workflow departments.

### Task 4: Import Lineage

**Files:**
- Modify: `shared/api-types/project-v2.ts`
- Modify: `server/api/v2/repositories/project-v2-repository.ts`
- Modify: `server/api/v2/services/project-v2-service.ts`
- Modify: `client/src/components/ProjectCommandHeader.tsx`

- [x] Add project-level Smart Import lineage to the V2 detail response.
- [x] Show live/stale/missing import state in the command header and trust surfaces.
- [x] Keep Excel-mastered values read-only in summary contexts.

### Task 5: Verification And Documentation

**Files:**
- Modify: `docs/project-detail-source-of-truth-map.md`
- Create: `docs/project-detail-final-qa-checklist.md`

- [x] Update source-of-truth map for the new command-centre and workflow groups.
- [x] Add final QA checklist.
- [x] Run focused Vitest suite and TypeScript checks.
- [x] Run Playwright smoke validation with mocked Project Detail API responses.

### Task 6: Page Shell Split For File-Size Ratchet

**Files:**
- Create: `client/src/components/tabs/ProjectEngineeringTasksTab.tsx`
- Modify: `client/src/pages/project-detail.tsx`
- Modify: `qa/fixtures/file-size-baseline.json`

- [x] Move the embedded engineering task tab out of the Project Detail page shell.
- [x] Keep the Project Detail page under its file-size ratchet cap.
- [x] Refresh only the Project Detail baseline entry to lock in the shrink without masking unrelated ratchet failures.

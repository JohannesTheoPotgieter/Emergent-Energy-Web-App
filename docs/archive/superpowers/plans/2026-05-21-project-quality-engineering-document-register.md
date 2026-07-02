# Project Quality and Engineering Document Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SharePoint-backed project document register inside Project Detail -> Engineering and Project Detail -> Quality, with red defects and role-aligned permissions.

**Architecture:** Add a companion `project_document_links` metadata table keyed to projects and optional `managed_documents` rows. Backend routes expose list/link/update operations and compute defects from durable SharePoint references. A shared Project Detail component renders the live SharePoint folder browser, linked document rows, summary counts, and document detail actions for Engineering and Quality.

**Tech Stack:** TypeScript, Express, Drizzle ORM, PostgreSQL migrations, React, TanStack Query, Vitest.

---

### Task 1: Shared Policy and Defect Engine

**Files:**
- Create: `shared/project-document-register.ts`
- Test: `qa/tests/unit/project-document-register.test.ts`

- [ ] **Step 1: Write the failing test**

Create `qa/tests/unit/project-document-register.test.ts` with tests that assert:

```ts
import { describe, expect, it } from "vitest";
import {
  computeProjectDocumentDefects,
  getProjectDocumentPermissions,
} from "../../../shared/project-document-register";

describe("project document register policy", () => {
  it("marks approved documents without SharePoint link and approval timestamp as red defects", () => {
    const result = computeProjectDocumentDefects({
      domain: "engineering",
      status: "approved",
      reviewStatus: "approved",
      driveId: null,
      itemId: null,
      webUrl: null,
      reviewerUserId: 12,
      approverUserId: 13,
      approvedAt: null,
      currentRevision: true,
      superseded: false,
      dueDate: null,
      closeOutEvidenceRequired: false,
      closeOutEvidenceLinked: false,
      syncConfidence: "high",
    });

    expect(result.flag).toBe("red");
    expect(result.defects.map((d) => d.code)).toEqual([
      "missing_sharepoint_link",
      "missing_approval_timestamp",
    ]);
  });

  it("prevents engineers from approving engineering documents while allowing engineering managers", () => {
    expect(getProjectDocumentPermissions("ENGINEER", "engineering").canApprove).toBe(false);
    expect(getProjectDocumentPermissions("ENGINEERING_MANAGER", "engineering").canApprove).toBe(true);
  });

  it("allows PMs to link but not approve quality documents", () => {
    const permissions = getProjectDocumentPermissions("PROJECT_MANAGER_SITE", "quality");
    expect(permissions.canLink).toBe(true);
    expect(permissions.canApprove).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run test -- qa/tests/unit/project-document-register.test.ts`

Expected: FAIL because `shared/project-document-register.ts` does not exist.

- [ ] **Step 3: Implement the shared module**

Create `shared/project-document-register.ts` with:

- `ProjectDocumentDomain = "engineering" | "quality"`
- workflow status unions matching the design
- `getProjectDocumentPermissions(role, domain)`
- `computeProjectDocumentDefects(input)`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd run test -- qa/tests/unit/project-document-register.test.ts`

Expected: PASS.

### Task 2: Schema, Migration, Repository

**Files:**
- Modify: `shared/schema/documents.ts`
- Create: `migrations/0068_project_document_links.sql`
- Create: `server/repositories/project-document-register-repository.ts`

- [ ] **Step 1: Add schema and migration**

Add `project_document_domain_enum`, `project_document_status_enum`, `project_document_review_status_enum`, and `project_document_links`.

The table must store:

- project/document linkage
- SharePoint `driveId`, `itemId`, `webUrl`, `folderPath`, `fileName`
- document type, discipline, revision
- status/review/current/superseded fields
- owner, due date, prepared/reviewed/approved IDs and timestamp
- sign-off and close-out evidence flags
- sync confidence and last sync timestamp
- soft delete timestamps

- [ ] **Step 2: Add repository**

Add list, get, upsert, and update functions. Repository functions must catch missing-table errors and return empty/null where appropriate so local dev remains stable before migrations are applied.

- [ ] **Step 3: Run typecheck**

Run: `npm.cmd run check`

Expected: PASS.

### Task 3: Backend Routes and Permissions

**Files:**
- Modify: `shared/schema/users.ts`
- Modify: `shared/permissions/registry.ts`
- Create: `server/routes/project-document-register.routes.ts`
- Modify: `server/routes/index.ts`

- [ ] **Step 1: Add permission entities**

Add:

- `project_document_register`
- `engineering_documents`
- `quality_documents`
- `sharepoint_sync`

Defaults must align with the approved matrix:

- Engineering approval: `ENGINEERING_MANAGER`, `COO_ADMIN`, `CEO_ADMIN`
- Quality approval: `QUALITY_MANAGER`, `COO_ADMIN`, `CEO_ADMIN`
- PM can view/link but not approve
- External users are not represented in company roles and receive no access

- [ ] **Step 2: Add routes**

Add routes:

- `GET /api/projects/:projectId/document-register?domain=engineering|quality`
- `POST /api/projects/:projectId/document-register/link`
- `PATCH /api/projects/:projectId/document-register/:linkId`

The link route must use Graph item metadata from `sharepoint-document-service.getItem`, persist or update the corresponding `managed_documents` row, then persist project document metadata. It must not copy file content.

- [ ] **Step 3: Register routes**

Import and call `registerProjectDocumentRegisterRoutes(app)` in `server/routes/index.ts`.

- [ ] **Step 4: Run unit and type checks**

Run:

- `npm.cmd run test -- qa/tests/unit/project-document-register.test.ts`
- `npm.cmd run test -- qa/tests/unit/permissions-route-contract.test.ts`
- `npm.cmd run check`

Expected: PASS.

### Task 4: Project Detail Documents UI

**Files:**
- Create: `client/src/components/project-documents/ProjectDocumentRegisterPanel.tsx`
- Modify: `client/src/pages/project-detail.tsx`

- [ ] **Step 1: Add shared panel**

Create a panel that accepts:

```ts
{
  projectId: number;
  projectName: string;
  domain: "engineering" | "quality";
}
```

It must render:

- summary cards
- linked document rows
- red/amber/ok flags
- selected document detail
- project SharePoint folder browser using existing `/api/documents/roots` and `/api/documents/:scope/:rootId/children`
- link form for selected SharePoint files

- [ ] **Step 2: Wire Engineering tab**

Add an Engineering sub-tab named `Documents` and render the panel with `domain="engineering"`.

- [ ] **Step 3: Wire Quality tab**

Add a Quality sub-tab named `Documents` and render the panel with `domain="quality"`.

- [ ] **Step 4: Run client and full type checks**

Run:

- `npm.cmd run check:client`
- `npm.cmd run check`

Expected: PASS.

### Task 5: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

- `npm.cmd run test -- qa/tests/unit/project-document-register.test.ts`
- `npm.cmd run test -- qa/tests/unit/permissions-route-contract.test.ts`
- `npm.cmd run test -- qa/tests/unit/sharepoint-graph-access.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run: `npm.cmd run check`

Expected: PASS.

- [ ] **Step 3: Review git diff**

Run: `git diff --stat` and verify only document-register implementation files plus already-existing dirty files are present.

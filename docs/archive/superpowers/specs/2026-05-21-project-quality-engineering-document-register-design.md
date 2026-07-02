# Project Quality and Engineering Document Register Design

Date: 2026-05-21
Repository: JohannesTheoPotgieter/Emergent-Energy-Web-App
Status: Approved for implementation planning

## Purpose

Quality and Engineering document management must become trustworthy without turning project gates into hard blockers yet. The first slice will show red defects and "not ready" states inside Project Detail, while preserving SharePoint as the file source of truth.

The app will store document metadata, durable SharePoint references, review state, workflow state, and sync health. The app will not copy files into its own storage unless a separate approved reason is added later.

## Approved Scope

In scope:

- Project-level document register backed by SharePoint files.
- SharePoint folder tree that visually matches the current SharePoint layout.
- Engineering document view inside Project Detail -> Engineering tab.
- Quality document view inside Project Detail -> Quality tab.
- Shared document detail and review workflow.
- Red defects for missing links, broken SharePoint references, missing approvals, superseded current documents, stale sync, overdue quality items, and missing close-out evidence.
- Role and permission alignment through the app's Roles & Permissions model.
- SharePoint sync status and diagnostics for linked project documents.

Out of scope for this slice:

- Gate readiness page.
- Hard gate blocking.
- Stage movement enforcement.
- External document sharing.
- Creating a new non-manager Quality role.
- Copying files from SharePoint into app-managed file storage.

## Current State Summary

The app already has a real managed document model and SharePoint browser surface. The strongest existing foundation is:

- `managed_documents`
- `document_revisions`
- `document_locks`
- `document_comments`
- `document_activity`
- `folder_taxonomy`
- `project_folders`
- `company_sharepoint_roots`
- `document_approval_requirements`

The current gaps are:

- Quality evidence and NCR attachments can still use local URLs or file paths.
- Engineering deliverables can still use local upload storage.
- Drawing register records contain a SharePoint link field, but do not consistently store `driveId`, `itemId`, and `webUrl`.
- Engineering, Quality, controlled documents, and SharePoint browser flows are not yet unified around one project document register.
- The generic `documents` permission is too broad for Engineering and Quality approval authority.

## Architecture

SharePoint remains the document source of truth.

The app stores:

- `projectId`
- `driveId`
- `itemId`
- `webUrl`
- `folderPath`
- `fileName`
- `documentType`
- `discipline`
- `revision`
- `status`
- `currentRevision`
- `superseded`
- `reviewStatus`
- `owner`
- `dueDate` where applicable
- `lastSyncedAt`
- `syncConfidence`

Project Detail owns the user experience:

```text
Project Detail
  Engineering tab
    Engineering Documents
      SharePoint folder browser filtered to Engineering folders
      Drawing register, SLDs, layouts, IFC, AFC, as-built
      Engineering review and approval workflow

  Quality tab
    Quality Documents
      SharePoint folder browser filtered to Quality folders
      QA reports, phase certificates, NCRs, snags, commissioning, handover evidence
      Quality review and close-out workflow
```

The standalone Documents area remains useful for broader browsing and administration, but it is not the primary project workflow for this slice.

## Project Register Wireframe

```text
Project Detail: SOL-104 Riverside Mall

[ Overview ] [ Plan ] [ Engineering ] [ Quality ] [ Finance ] [ Risks ]

Engineering tab or Quality tab

+--------------------------------+---------------------------------------------+
| SharePoint Folders             | Folder Contents                             |
+--------------------------------+---------------------------------------------+
| v Emergent Energy Team Folder  | Current folder:                             |
|   v 01 - Clients               | /Emergent Energy Team Folder/01 - Clients/  |
|     v 0.Active Trackers        | 0.Active Trackers/SOL-104/...               |
|       > Engineering            |                                             |
|       > Quality                | +------+----------------+-----+-----------+ |
|       > Commissioning          | | Flag | File           | Rev | Register  | |
|   > 02 - Templates             | +------+----------------+-----+-----------+ |
|   > 03 - Internal              | | RED  | QA Phase 2.pdf | A01 | Not link  | |
|                                | | OK   | Site SLD.pdf   | C03 | Eng Doc   | |
|                                | | AMB  | Layout.dwg     | B02 | Review    | |
|                                | +------+----------------+-----+-----------+ |
+--------------------------------+---------------------------------------------+

Selected file: Site SLD.pdf
+------------------------------------------------------------------------------+
| SharePoint file                                                               |
| driveId: present                                                              |
| itemId: present                                                               |
| webUrl: present                                                               |
| Folder path: Emergent Energy Team Folder/01 - Clients/0.Active Trackers/...  |
| Link to register: [Engineering Document] [Drawing / SLD] [Link file]          |
+------------------------------------------------------------------------------+
```

Supported workflows:

- SharePoint-first: browse folder, select file, link to project document register.
- Register-first: create required document placeholder, show red until a SharePoint file is linked.

## Engineering Tab Design

```text
Project Detail -> Engineering

+------------------------------------------------------------------------------+
| Engineering Documents                                                         |
+------------------------------------------------------------------------------+
| Drawings: 24 | Current revs: 21 | Pending review: 3 | Red defects: 4          |
| IFC ready: 16 | AFC ready: 9 | As-built: 2 | Superseded: 5                   |
+------------------------------------------------------------------------------+

Filters:
[Discipline] [Type] [IFC/AFC/As-built] [Current only] [Search]

+------+------------+------------+-----+---------+----------+-------------+
| Flag | Drawing    | Discipline | Rev | Status  | Review   | SharePoint  |
+------+------------+------------+-----+---------+----------+-------------+
| OK   | EE-SLD-001 | Electrical | C03 | IFC     | Approved | Linked      |
| RED  | EE-LAY-004 | Electrical | B02 | AFC     | Draft    | Missing     |
| RED  | EE-CIV-002 | Civil      | A01 | IFC     | Review   | Linked      |
| AMB  | EE-ASB-009 | Electrical | D01 | AsBuilt | Review   | Linked      |
+------+------------+------------+-----+---------+----------+-------------+
```

Engineering rules:

- Engineering users can create, link, edit, and submit engineering document records.
- `ENGINEERING_MANAGER` can approve engineering documents and mark revisions current or superseded.
- `COO_ADMIN` and `CEO_ADMIN` can override with an audit trail.
- `ENGINEER` cannot final-approve engineering documents.
- Only current, non-superseded, approved revisions are considered ready.
- Missing SharePoint link is always red.
- Missing reviewer or approval timestamp prevents Approved display.

## Quality Tab Design

```text
Project Detail -> Quality

+------------------------------------------------------------------------------+
| Quality Documents                                                             |
+------------------------------------------------------------------------------+
| QA reports: 12 | NCRs open: 3 | Snags open: 8 | Red defects: 6                |
| Phase certs: 4/5 | Commissioning: 7 | Handover: 42% | Overdue: 5             |
+------------------------------------------------------------------------------+

Filters:
[Type] [Owner] [Review Status] [Overdue only] [Search]

+------+-------------+---------------+-----------------+------------+-------------+
| Flag | Document    | Type          | Owner           | Due        | SharePoint  |
+------+-------------+---------------+-----------------+------------+-------------+
| OK   | QA-IR-014   | Inspection    | QA Lead         | 2026-05-20 | Linked      |
| RED  | PC-Phase-02 | Phase Cert    | PM              | 2026-05-18 | Missing     |
| RED  | NCR-018     | NCR           | QUALITY_MANAGER | 2026-05-22 | Linked      |
| AMB  | CP-EV-009   | Commissioning | ENGINEER        | 2026-05-28 | Linked      |
+------+-------------+---------------+-----------------+------------+-------------+
```

Quality rules:

- `QUALITY_MANAGER` can create, link, approve, and close out quality documents in this slice.
- `PROJECT_MANAGER_SITE` can view and link project quality evidence, but cannot approve it.
- `CONSTRUCTION_MANAGER` can view and link site-related quality documents where existing permissions allow.
- NCRs, snags, commissioning evidence, phase certificates, handover evidence, close-out photos, and QA reports need SharePoint links when used as evidence.
- Missing close-out evidence is red.
- Overdue due date is red.
- Approved quality documents require reviewer, approver, and approval timestamp.

## Document Detail and Workflow

```text
Project Detail -> Engineering or Quality -> Document Detail

Document: EE-SLD-001 - Main Site SLD
Type: Engineering / SLD
Revision: C03
Status: Submitted for Review

+-------------------------------+----------------------------------------------+
| SharePoint Source             | Register Metadata                            |
+-------------------------------+----------------------------------------------+
| File: EE-SLD-001-C03.pdf      | Project: SOL-104 Riverside Mall              |
| Folder: /Engineering/SLDs     | Discipline: Electrical                       |
| driveId: present              | Document type: SLD                           |
| itemId: present               | Revision: C03                                |
| webUrl: present               | Current revision: yes                        |
| Last synced: 21 May 2026      | Superseded: no                               |
| Sync confidence: High         | Owner: ENGINEERING_MANAGER                   |
+-------------------------------+----------------------------------------------+

+-------------------------------+----------------------------------------------+
| Workflow                      | Required Review                              |
+-------------------------------+----------------------------------------------+
| Draft                         | Prepared by: ENGINEER                        |
| Submitted for Review          | Reviewed by: ENGINEERING_MANAGER             |
| Changes Required              | Approved by: ENGINEERING_MANAGER             |
| Approved                      | PrEng sign-off: required where configured    |
| Superseded                    | Approval timestamp: missing                  |
| Rejected                      |                                              |
| Archived                      |                                              |
+-------------------------------+----------------------------------------------+

+------------------------------------------------------------------------------+
| Red Defects                                                                  |
+------------------------------------------------------------------------------+
| RED  Approval timestamp missing                                              |
| RED  Required sign-off missing                                               |
+------------------------------------------------------------------------------+

Actions:
[Open in SharePoint] [Submit for Review] [Request Changes] [Approve] [Reject]
```

Workflow states:

- Draft
- Submitted for Review
- Changes Required
- Approved
- Superseded
- Rejected
- Archived

Approval controls:

- A document cannot display as Approved without reviewer, approver, and approval timestamp.
- A document cannot display as Approved without `driveId`, `itemId`, and `webUrl`.
- Superseded documents cannot display as current.
- Approval authority must match document domain.
- COO and CEO overrides must be audited.

## Roles and Permissions Alignment

The implementation must use the app's canonical company roles:

- `COO_ADMIN`
- `CEO_ADMIN`
- `CCO`
- `CFO`
- `PROGRAM_MANAGER`
- `PROGRAM_FINANCE_MANAGER`
- `CONSTRUCTION_MANAGER`
- `QUALITY_MANAGER`
- `ENGINEERING_MANAGER`
- `KEY_ACCOUNTS_MANAGER`
- `ACCOUNTANT`
- `ENGINEER`
- `PROJECT_MANAGER_SITE`
- `PROJECT_DEVELOPER`
- `HSE_MANAGER`
- `SSEG_MANAGER`

The redesign introduces or separates these permission concepts in Roles & Permissions:

1. Project Document Register
   - view
   - link SharePoint file
   - edit metadata
   - mark superseded
   - delete or unlink metadata

2. Engineering Documents
   - view
   - create or link
   - edit revision metadata
   - submit for review
   - approve
   - mark current or superseded

3. Quality Documents
   - view
   - create or link
   - edit evidence metadata
   - submit for review
   - approve
   - close out evidence

4. SharePoint Sync
   - view sync status
   - run folder scan
   - relink broken references
   - edit root or folder config

5. Documents Admin
   - manage document types
   - manage folder mapping
   - manage approval requirements

First-slice matrix:

```text
Role                    Register       Engineering Docs          Quality Docs             Sync
------------------------------------------------------------------------------------------------
COO_ADMIN               All            Override and audit        Override and audit       All
CEO_ADMIN               View all       Override and audit        Override and audit       View all
ENGINEERING_MANAGER     View/link      Approve/supersede         View                    View
ENGINEER                View/link      Create/edit/submit        View                    View
QUALITY_MANAGER         View/link      View                      Approve/close-out       View
PROJECT_MANAGER_SITE    View/link      View/link project docs    View/link evidence      View
PROGRAM_MANAGER         View/link      View                      View                    View
CONSTRUCTION_MANAGER    View           View                      View/link site docs     View
HSE_MANAGER             View           View                      View where relevant     View
SSEG_MANAGER            View           View                      View where relevant     View
CFO                     View           View-only                 View-only               View
PROGRAM_FINANCE_MANAGER View           View-only                 View-only               View
ACCOUNTANT              View           View-only                 View-only               View
CCO                     View           View-only                 View-only               View
KEY_ACCOUNTS_MANAGER    View           View-only                 View-only               View
PROJECT_DEVELOPER       View           View-only                 View-only               View
External users          None           None                      None                    None
```

Backend enforcement:

- UI visibility must use Roles & Permissions.
- Backend mutation endpoints must enforce the same permission model.
- Approval decisions must require assigned approver plus required role.
- SharePoint write operations still flow through Microsoft Graph and are not bypassed by app permissions.
- App permissions cannot grant access to a SharePoint file the Microsoft principal cannot access.

## SharePoint Sync and Defects

```text
Project Detail -> Engineering or Quality -> SharePoint Sync Panel

+------------------------------------------------------------------------------+
| SharePoint Source                                                             |
+------------------------------------------------------------------------------+
| Site: emergy.sharepoint.com/...                                               |
| Drive: Emergent Energy Team Folder                                            |
| Project root: /01 - Clients/0.Active Trackers/SOL-104 Riverside Mall          |
| Last sync: 21 May 2026 15:10                                                  |
| Sync confidence: High                                                         |
+------------------------------------------------------------------------------+

+-------------------------------+----------------------------------------------+
| Folder Scan                   | Issues                                       |
+-------------------------------+----------------------------------------------+
| Folders scanned: 18           | 3 files not linked to register               |
| Files discovered: 146         | 2 register documents missing SharePoint link |
| Linked files: 121             | 1 linked file no longer found in SharePoint  |
| Unlinked files: 25            | 0 permission errors                          |
+-------------------------------+----------------------------------------------+
```

Red defects:

- Missing SharePoint link.
- Broken SharePoint item reference.
- Required review has no reviewer.
- Approved state has no approval timestamp.
- Current revision flag missing or contradictory.
- Superseded document still marked current.
- Quality evidence overdue.
- Quality close-out evidence missing.
- Sync confidence is Low or Stale.

Amber warnings:

- SharePoint file exists but is not linked to the register.
- Metadata looks incomplete but the document is not required for approval yet.
- Sync is delayed but still within tolerated window.

## Data Model Direction

The implementation should reuse the existing managed document foundation where possible.

Additive fields or tables may be needed to represent:

- document domain: Engineering or Quality
- document type
- discipline
- revision label
- status
- current revision flag
- superseded flag
- owner
- due date
- review status
- prepared by
- reviewed by
- approved by
- approval timestamp
- sign-off requirement flags
- close-out evidence state
- sync confidence
- last synced time

The implementation plan must decide whether to extend `managed_documents` directly or add a companion project document metadata table keyed to `managed_documents.id`. A companion table is preferred if it avoids overloading the generic SharePoint browser model.

## Acceptance Criteria

The first implementation slice is accepted when:

- Project Detail -> Engineering shows real SharePoint-linked engineering documents or clear red defects where links are missing.
- Project Detail -> Quality shows real SharePoint-linked quality documents or clear red defects where links are missing.
- The SharePoint folder tree matches the current SharePoint layout and supports browsing by actual Graph folder contents.
- Files can be linked to project document metadata without copying the file.
- Linked records store durable `driveId`, `itemId`, and `webUrl`.
- Missing SharePoint link displays as a red defect.
- Superseded current documents display as red defects.
- Approved documents without reviewer, approver, or approval timestamp display as red defects.
- Engineering approval authority aligns with `ENGINEERING_MANAGER`, plus audited COO/CEO override.
- Quality approval authority aligns with `QUALITY_MANAGER`, plus audited COO/CEO override.
- PM users can view and link project documents but cannot approve Engineering or Quality documents.
- External users have no internal document access in this slice.
- Existing Outlook integration and existing project tracker import rules are unchanged.
- No access tokens, refresh tokens, client secrets, or auth headers are exposed in logs or UI.

## Implementation Notes for Planning

The implementation should be split into small, verifiable slices:

1. Add canonical document metadata and permission definitions.
2. Add project document register query and link/unlink APIs.
3. Add SharePoint folder browser integration inside Project Detail tabs.
4. Add Engineering tab filtered view and red defects.
5. Add Quality tab filtered view and red defects.
6. Add document detail workflow controls.
7. Add sync diagnostics and tests.

The implementation plan must avoid changing project gate behavior in this slice.

# Session review — `claude/platform-overhaul-3WF1E`

Detailed review of every change that landed on this branch during the platform-overhaul session.

Sections:
- **A. Branch-level summary** — headline, scope, state, one-line commit list.
- **B. Features by theme** — D1-D5, R1-R6 and related work in detail.
- **C. Deferred / not done** — explicit list with reasons.
- **D. How to test in dev** — pull, migrate, click-through.

---

## A. Branch-level summary

### Headline

A broad platform overhaul requested by the user ("professional, clean, simple, integrated") driven against four locked design principles:

1. **Simplistic modern reactive look + renewable emerald accent** (R1).
2. **Actionable everywhere** — every surface element deep-links to the exact thing.
3. **Full front-end maintainability** for super users (COO_ADMIN / CEO_ADMIN) — edit + delete with visible cascade.
4. **Department-by-department audit** answering four business questions per screen: *what is the real-life job · is the screen necessary · does it work end-to-end · can a super user manage it from the front end?*

### Scope

- **7 departments** audited (PD · PM · Engineering · Quality · HSE · Finance · Handover).
- **6 new role-specific home surfaces** built or consolidated (CEO home · COO home · Settings home · QuickBooks home · Document types admin · Live handover meeting).
- **Document control end-to-end** — 13-type taxonomy + submit/approve/reject/recall + history + Excel headline extraction + SharePoint draft picker.
- **Cascade-delete** coverage across 6 entities with typed-confirmation dialogs.
- **Email / Teams project-linking** foundations — schema, server repo, layered-signal auto-linker, project-detail Communications tab.
- **Universal ⌘K search** federated across 7 entity types.
- **Keyboard nav** leader-key shortcuts + help dialog.
- **R1 visual first pass** — emerald-tinted tokens, primitive consistency, chrome trim.

### State on branch

- **All `npm run check` clean** (server + client TypeScript).
- **3 new migrations** (0012, 0013, 0014, 0015) — all additive + idempotent.
- **Mock-connector aware** for every MS Graph + Excel integration — dev works without tenant tokens.
- **Three design docs** in `docs/overhaul/` for navigation + audit + progress tracking.

### Commit index (oldest → newest, session chronology)

```
ec6eb2fc  R1 visual direction (first pass)
ee6d590c  D3.1 document-control data model
f15d291d  D3.2 repository + read APIs
7f7cdda0  D3.3 submit / approve / reject / recall + queue
beab94a7  D3.4a ApprovalQueueCard + DocumentApprovalDialog
a6bed286  D3.4b DocumentStrip + DocumentSubmitDialog
7a02b84d  D1 CEO home + D2 COO home
e8ce0eb0  R3 ConfirmDestructive primitive
3f6c6547  D5.1 Settings home
ef3079ac  R2 ⌘K palette federated search
32759969  docs overnight progress
c8745c45  D3.4c standalone project-documents page
c043e54d  docs refresh
c5e5063b  D3.4d DocumentStrip on project-detail
dff44e3a  R4.1 project delete-impact
3c2a3d4b  R4.2 useDeleteImpact + DeleteProjectDialog
e3310997  R5 QuickBooks home
1cee5ab0  docs refresh
a40c3d71  D5.2a doc-types CRUD API
83e68fdb  D5.2b doc-types editor UI
03c0af01  D5.3 project SharePoint root config
b10119ea  R4.3 client cascade-delete
d319ce80  R6.1 keyboard navigation
cf277388  D4 live handover meeting interface
bf285e23  docs refresh
0f0363e0  audit PD department + risk drill-ins
da62f1fd  audit PM + ApprovalQueueCard on /pm-dashboard
eb08f6ad  audit Engineering/Quality/HSE + queue cards
99c18527  opportunities ?filter= wiring
f696bc68  project-create SharePoint root input
c417d66d  schema email-domain columns
c971fb83  clients PATCH email-domain fields
75cb170c  R4.4 PO cascade
8b583d2f  docs refresh
80c9ca2d  D4 persistence (attendees + notes)
fec21d3c  R4.5 invoice cascade
5cdb63a1  ClientEditDialog
0071fa63  docs refresh
e55f9196  email-links schema
c7e87859  email-links repo + API
f029a0e4  email-links Communications tab
31c75630  docs refresh
e1362b74  R4.6 + R4.7 work items + controlled docs cascade
7eca2891  D3.5 + D3.6 SharePoint + Excel (mock-aware)
e303c3f3  email auto-linker consumer + mock ingester
```

Feature-by-theme breakdown continues in section B below.

---

## B. Features by theme

### R1 — Visual direction (first pass)

**What changed:**
- `--accent` + `--sidebar-accent` tokens (light + dark) shifted to emerald-tinted HSL so every Radix primitive (dropdown, command palette, select, dialog) now reads as brand-aligned on hover/active rather than generic gray.
- `LensNav` active item gets a 3px emerald left-rail accent.
- `Table` row hover uses `surface-tint` (subtle emerald). Selected rows get a 3px emerald inset-shadow left-border.
- `Button` hover on `default` + `destructive` adds `shadow-sm` for a subtle reactive lift; `outline` + `ghost` hover use `surface-tint`.
- `AppLayout` chrome — leaf-only mark on mobile, full wordmark on desktop, both with hover motion cues. Hard border between section-nav stripe and top bar removed; breadcrumb strip uses `surface-tint/40` background.
- `ee-subnav-pill` active state tightened (`primary/10` bg + `primary/20` border).

**Files**: `client/src/index.css`, `client/src/components/layout/LensNav.tsx`, `client/src/components/ui/table.tsx`, `client/src/components/ui/button.tsx`, `client/src/components/layout/AppLayout.tsx`.

**Commits**: `ec6eb2fc`.

### D1 — CEO pre-execution home

**What was built:**
- `/ceo` route, role-landing for `CEO_ADMIN`.
- Three-column pre-execution pipeline (First Assessment · Cost Proposal & Design · Signature & Financial Close) with deal cards per stage.
- Upcoming handovers card with per-row "Live room →" link to the D4 meeting interface.
- Overarching lifecycle strip with clickable counts for all 9 execution stages.
- Approval queue card (Waiting on me).

**Files**: `client/src/pages/ceo-home.tsx`.
**Commits**: `7a02b84d`, `cf277388`.

### D2 — COO morning check

**What was built:**
- `/coo` route, role-landing for `COO_ADMIN`.
- Ordered around how COO's eyes move: Waiting on me · Priorities · Red/Blocked/Amber projects · Engineering/Quality/HSE/Finance drill tiles · Upcoming handovers · Financial pulse column.
- Every row deep-links to the specific thing per the "actionable everywhere" rule.

**Files**: `client/src/pages/coo-home.tsx`.
**Commits**: `7a02b84d`.

### D3 — Document control (Drafts / Approved / History)

**Schema** (`shared/schema/documents.ts`):
- `controlled_document_types` — taxonomy + default approver roles + `requiresAllApprovers` flag + extract spec for Excel cell mapping.
- `controlled_documents` — metadata only (never bodies); state lifecycle `draft | submitted | approved | rejected | superseded | recalled`.
- `project_sharepoint_roots` — per-project root folder path config.

**Approval workflow** reuses the existing `approvals` table via `approvalType='controlled_document'` — zero new approval machinery.

**Seed**: 13 document types with the locked approval matrix (Costing Excel → CEO; EPC Contract → COO; Financial Close Pack → CFO + COO; Project Charter → Program Manager + COO; etc.).

**API**:
- `GET /api/controlled-documents/types` · `GET /api/projects/:id/controlled-documents[/typeKey]`
- `POST /api/projects/:id/controlled-documents/submit`
- `POST /api/controlled-documents/:id/approve|reject|recall`
- `GET /api/approvals/queue`
- `GET /api/projects/:id/sharepoint-root` · `PUT` (super-user)
- `GET /api/projects/:id/sharepoint-drafts/:typeKey` (D3.5 draft picker)

**UI primitives** (in `components/controlled-documents/`):
- `DocumentStrip` — per-project rows with version badges, pending/history counts, submit button.
- `DocumentSubmitDialog` — one dropdown per required role; super-users always allowed as override approvers.
- `DocumentApprovalDialog` — approve/reject tabs with SharePoint preview link.
- `ApprovalQueueCard` — drop-in for any dashboard; now on CEO · COO · PM · Engineering · Quality · HSE.
- `ProjectSharepointRootCard` — super-user config of the project's SharePoint root.
- `DeleteControlledDocDialog` — R4.7 cascade-delete wrapper.

**Integrations** (mock-connector aware):
- `sharepoint-doc-control-service.ts` — `listDraftFiles`, `promoteDraftToApproved`, `ensureDocControlFolders`. Real Graph calls stubbed with informative errors so dev works end-to-end against fixtures.
- `excel-extraction-service.ts` — `extractCostingValues` auto-runs inside `recordApproval` when the type has an `extractSpec`. Mock mode returns deterministic-per-file headline numbers so the CEO home shows realistic Revenue / CoS / Margin.

**Commits**: `ee6d590c` · `f15d291d` · `7f7cdda0` · `beab94a7` · `a6bed286` · `c8745c45` · `c5e5063b` · `7eca2891`.

### D4 — PD → PM live handover meeting

**What was built:**
- `/handover/:projectId/live` route.
- Room bar with 9 attendee role chips (PD, PM, COO, CFO, Engineer, Construction Mgr, HSE, SSEG, Quality) — click to tick in/out.
- Sequential 6-step walk through the existing project charter (Overview, Stakeholders, Scope, Schedule, Budget, Risks) with a facilitator-prompt box per step.
- Per-step notes textarea (persisted with the acceptance row).
- Right-column DecisionLog captures decisions live.
- Final step: Accept / Accept-with-Reservations / Reject decision with reason capture. Posts to existing `/api/projects/:id/acceptances`; `stage_acceptances` got two new columns (migration 0014) so attendees + section_notes persist.
- Entry point on CEO home Upcoming Handovers card.

**Files**: `client/src/pages/handover-live.tsx`, migration `0014_handover_meeting_capture.sql`, `shared/schema/collaboration-workflow.ts` (schema extension), `server/services/collaboration-workflow-service.ts` (createAcceptance signature extension).

**Commits**: `cf277388` · `80c9ca2d`.

### D5 — Settings rewrite

**What was built:**
- `/settings` — super-user-only grouped landing with 5 concern areas (People · Documents · Integrations · Workflow · Operational), 14 named cards each with a one-line job description.
- `/admin/document-types` — full CRUD editor for the doc-type taxonomy (add / edit / soft-deactivate, select approver roles from a 12-role checklist, multi-approver toggle, sort order).
- Per-project `ProjectSharepointRootCard` on project-detail.

**Commits**: `3f6c6547` · `a40c3d71` · `83e68fdb` · `03c0af01`.

(Continues in the next review piece.)

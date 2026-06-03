# Navigation Audit & Modern Redesign Proposal

**Prepared for:** Johannes Theo Potgieter (COO)
**Date:** 2026-06-03
**Scope:** Every active, reachable screen — how you get to it, what tab lights
up, and whether "where you came from" is correct. Plus a proposed modern
navigation setup.

> This is an assessment + proposal. No application code has been changed.

---

## 1. Executive summary

The **chrome is clean and consistent** (sticky header, global search, top tabs →
sub-nav pills → breadcrumbs, mobile bottom-bar + drawer, ⌘K palette). The
**problem is reachability**: the menu only exposes a fraction of the app.

- The top nav is hard-locked to **6 tabs** (Home · Project Delivery · Finance ·
  Engineering · Quality Management · Settings) — `TOP_SECTIONS` in
  `client/src/config/app-navigation.ts`.
- The app actually renders **127 destination screens** (plus 20 detail pages) —
  `PAGE_REGISTRY` in `client/src/config/page-registry.ts`.
- **Only 27** screens are clickable from the navigation.
- **60** screens light up the **wrong tab** (Home) because no section matches them.
- **40** screens are reachable **only by typing the URL** — no tab, no ⌘K entry,
  no in-app link, no role-landing.
- **10 of 16 roles** are dropped on a landing page that has **no tab to return to
  it** — including **you**: COO/CEO land on `/now`, which the nav can't reach.

Root cause: two sources of truth drifted apart. `PAGE_REGISTRY` knows every page
and its `navGroup`; `TOP_SECTIONS` is a separate hand-curated list of 6. The nav
renders from the short list, so everything else falls through.

---

## 2. How navigation works today

| Layer | File | Role |
|---|---|---|
| App chrome / layout | `client/src/components/layout/AppLayout.tsx` | Header, top tabs, sub-nav pills, breadcrumb row, mobile bottom bar + drawer |
| Visible nav model | `client/src/config/app-navigation.ts` | `TOP_SECTIONS` (6 tabs + their pills), `getBreadcrumbs`, `linkIsActive`, role→section visibility |
| All routes | `client/src/config/page-registry.ts` | `PAGE_REGISTRY` (169 entries → 127 pages, 20 detail, 22 redirects) |
| Route → component | `client/src/config/route-components.ts` | Lazy component map |
| Command palette | `client/src/components/GlobalCommandPalette.tsx` | ⌘K — indexes only `showInSidebar:true` pages + entity search |
| Settings hub | `client/src/pages/settings-home.tsx` | Only **4 cards**, COO/CEO-gated |

**Reachability surfaces that exist:**

1. **Top tabs** (6) → **sub-nav pills** (3–8 per tab). The only always-visible
   click path. Covers 27 pages.
2. **Header search box** — searches *entities* (projects/invoices/people), **not
   pages**. Does not navigate to a screen by name.
3. **⌘K command palette** — the only "jump to a page" tool, but it filters to
   `showInSidebar:true` (~30 pages) and is keyboard-discovery only.
4. **Settings home** — 4 admin cards (Roles, Functionality, Integrations, Audit).
   The old "Control Center" launcher that listed all admin tools now **redirects
   to Settings**. Only 6 of 22 admin pages share the `AdminShell` lateral nav.
5. **Home page** (`/`) — a personal focus board (Priorities, Do Next, 4-week
   look-ahead). It is **not a directory**; its only links are My Work, Priorities,
   and project deep-links.
6. **Role-landing redirect** — drops a role on one page at login/lens-switch.
7. **Direct URL / bookmarks / in-app deep links.**

All screens are **enabled by default** (`isScreenEnabled` returns true unless an
admin disables it in Functionality Control), so every page below is genuinely
live — the gap is navigation, not availability.

---

## 3. The numbers

| Reachability of the 127 destination screens | Count |
|---|---|
| Clickable from the top nav (tab or sub-nav pill) | **27** |
| Deep pages whose **correct** tab lights up (reachable in-context / deep link) | 40 |
| Pages where **no tab matches** → Home tab wrongly highlighted | **60** |
| Reachable **only by typing the URL** (no tab, no ⌘K, no link, no landing) | **40** |

---

## 4. Full reachability matrix

Legend for **How you reach it**: `TAB`/`PILL` = top nav · `⌘K` = command palette ·
`LANDING` = role landing redirect · `LINK` = an in-app page links to it ·
`URL-ONLY` = no path except typing the URL.

### 4.1 Tab lights up: **Home** ✅

| Path | Label | How you reach it | Breadcrumb |
|---|---|---|---|
| `/inbox` | Inbox | PILL | ok |
| `/my-work` | My Work | ⌘K, LINK | ok |
| `/my-work/calendar` | Calendar | PILL | ok |
| `/my-work/email` | Email | LINK | ok |
| `/my-work/meetings` | Meetings | PILL | ok |
| `/my-work/settings` | Settings | URL-ONLY | ok |
| `/my-work/tasks` | Tasks | LINK | ok |
| `/my-work/teams` | Teams Chat | ⌘K, LINK | ok |
| `/priorities` | Priorities | PILL | ok |
| `/priorities/lineage` | Priority Lineage | LINK | ok |

### 4.2 Tab lights up: **Project Delivery** ✅

| Path | Label | How you reach it | Breadcrumb |
|---|---|---|---|
| `/execution-board` | Execution Board (legacy) | TAB | ok |
| `/execution-board/construction` | Construction View | LINK | ok |
| `/execution-board/finance` | Program Finance | LINK | ok |
| `/execution-board/program` | Program View | LINK | ok |
| `/execution-board/realisation` | Realisation KPIs | LINK | ok |
| `/milestone-tracker` | Revenue Milestones | PILL | ok |
| `/projects` | All Projects | PILL | ok |

### 4.3 Tab lights up: **Finance** ✅ (but 4 are URL-only)

| Path | Label | How you reach it | Breadcrumb |
|---|---|---|---|
| `/cashflow` | Cashflow | TAB, LANDING | ok |
| `/cashflow/analysis` | Cashflow Analysis | LINK | ok |
| `/cos` | COS | PILL | ok |
| `/cos/analysis` | COS Analysis | **URL-ONLY** | ok |
| `/finance/audit-prep` | Audit Prep | ⌘K | ok |
| `/finance/gp` | GP — by project | **URL-ONLY** | ok |
| `/finance/gp/company` | GP | PILL | ok |
| `/finance/quickbooks` | QB Throughput | PILL | ok |
| `/finance/quickbooks-customer-mapping` | QB Customer Mapping | LINK | ok |
| `/finance/quickbooks-links` | QB Bill Linking | **URL-ONLY** | ok |
| `/fye-revenue-tracking` | FYE Tracking | PILL | ok |
| `/payment-batch-manager` | Payment Batches | **URL-ONLY** | ok |
| `/payment-request-board` | Payment Requests | PILL | ok |
| `/po-approval-board` | PO Approvals | PILL | ok |
| `/revenue-tracker` | Revenue | PILL | ok |

### 4.4 Tab lights up: **Engineering** ✅

| Path | Label | How you reach it | Breadcrumb |
|---|---|---|---|
| `/engineering` | Engineering | TAB, LANDING | ok |
| `/engineering/audit` | Engineering Audit Log | LINK | ok |
| `/engineering/documents` | Engineering Document Management | PILL | ok |
| `/engineering/standup` | Engineering Standup | PILL | ok |
| `/engineering/tasks` | Engineering Task Board | PILL | ok |

### 4.5 Tab lights up: **Quality Management** ✅

| Path | Label | How you reach it | Breadcrumb |
|---|---|---|---|
| `/quality` | Quality | TAB, LANDING | ok |
| `/quality/documents` | Quality Document Management | PILL | ok |
| `/quality/tasks` | Quality Task Board | PILL | ok |

### 4.6 Tab lights up: **Settings** — ⚠️ 16 of 27 are URL-only

The Settings tab highlights correctly, but the Settings home page only links to
4 of these. The other 22 admin pages have no card and no pill.

| Path | Label | How you reach it |
|---|---|---|
| `/admin/roles` | Roles & Permissions | PILL |
| `/admin/functionality` | Functionality Control | PILL |
| `/admin/integrations` | Integration Statuses | PILL |
| `/admin/activity-log` | Activity Log | PILL |
| `/admin/document-management` | Document management | LINK |
| `/admin/document-types` | Document types (legacy) | LINK |
| `/admin/import-control-tower` | Import Control Tower | LINK |
| `/admin/quickbooks` | QuickBooks Integration | LINK |
| `/admin/smart-import` | Smart Import | LINK |
| `/admin/work-item-linkage` | Work Item Linkage | LINK |
| `/admin/data-migration-status` | Data Migration Status | **URL-ONLY** |
| `/admin/database-migration` | Database Migration | **URL-ONLY** |
| `/admin/email-linker-dev` | Email auto-linker (dev) | **URL-ONLY** |
| `/admin/eng-templates` | Engineering Templates | **URL-ONLY** |
| `/admin/handover-health` | Handover Health Score | **URL-ONLY** |
| `/admin/kpi-traceability` | KPI Traceability | **URL-ONLY** |
| `/admin/lessons` | Lessons Learnt | **URL-ONLY** |
| `/admin/my-tool-settings` | My Work Settings | **URL-ONLY** |
| `/admin/phase-templates` | Phase Templates | **URL-ONLY** |
| `/admin/pipedrive` | Pipedrive Integration | **URL-ONLY** |
| `/admin/priority-templates` | Priority templates | **URL-ONLY** |
| `/admin/recovery` | Recovery Center | **URL-ONLY** |
| `/admin/settings` | System Settings | **URL-ONLY** |
| `/admin/sharepoint-intake` | SharePoint Intake | **URL-ONLY** |
| `/admin/stage-lifecycle` | Stage Lifecycle | **URL-ONLY** |
| `/admin/workflow-config` | Workflow Configuration | **URL-ONLY** |
| `/settings` | Settings | TAB |

### 4.7 ⚠️ Tab lights up: **NONE** → wrongly highlights Home (60 screens)

These render fine but no section `match()` claims them, so the **Home tab is
highlighted** and the breadcrumb root is mislabeled. Whole business domains live
here.

| Path | Label | How you reach it | Breadcrumb |
|---|---|---|---|
| `/pd` | Project Development Dashboard | LANDING, LINK | ⚠️ mislabeled |
| `/opportunities` | Opportunities | LINK | ⚠️ mislabeled |
| `/clients` | Clients | LINK | ⚠️ mislabeled |
| `/sites` | Sites | **URL-ONLY** | ⚠️ mislabeled |
| `/now` | Now | ⌘K, LANDING | ⚠️ mislabeled |
| `/my-queue` | My Queue | ⌘K, LINK | ⚠️ mislabeled |
| `/portfolio` | Portfolio | ⌘K | ⚠️ mislabeled |
| `/portfolios` | Portfolios | LINK | ⚠️ mislabeled |
| `/company-overview` | Company Overview | **URL-ONLY** | ⚠️ mislabeled |
| `/company/team` | Team | **URL-ONLY** | ⚠️ mislabeled |
| `/lifecycle-board` | Lifecycle Board | LINK | ⚠️ mislabeled |
| `/project-lifecycle` | Project Lifecycle | LINK | ⚠️ mislabeled |
| `/project-lifecycle/stage-gates` | Stage Gates | LINK | ⚠️ mislabeled |
| `/project-lifecycle/latest-updates` | Latest Updates | LINK | ⚠️ mislabeled |
| `/project-lifecycle/client-overview` | Client Overview | LINK | ⚠️ mislabeled |
| `/hse` | Health, Safety & Environment | LANDING, LINK | ⚠️ mislabeled |
| `/sseg-submissions` | SSEG Submissions | **URL-ONLY** | ⚠️ mislabeled |
| `/gates` | Gates Pipeline | LINK | ok |
| `/gates/blocked` | Blocked Gates | LINK | ok |
| `/gates/ready` | Ready Gates | **URL-ONLY** | ok |
| `/gates/exceptions` | Gate Exceptions | LINK | ok |
| `/gates/client-updates` | Client Updates | LINK | ok |
| `/gates/handovers` | Handover Queue | **URL-ONLY** | ok |
| `/gates/queries` | Open Queries | **URL-ONLY** | ok |
| `/gates/commitments` | Client Commitments | **URL-ONLY** | ok |
| `/handover` | Handover & Closeout | LINK | ⚠️ mislabeled |
| `/handover-control` | Handover Control | LINK | ⚠️ mislabeled |
| `/pm/handover-review` | PM Handover Review | LINK | ⚠️ mislabeled |
| `/pm/approvals` | Approvals | LINK | ⚠️ mislabeled |
| `/pm/on-the-go` | PM On-The-Go | LINK | ⚠️ mislabeled |
| `/pm-dashboard` | PM Dashboard | **URL-ONLY** | ⚠️ mislabeled |
| `/pending-approvals` | Pending Approvals | LINK | ⚠️ mislabeled |
| `/weekly-reviews` | Weekly Reviews | LINK | ⚠️ mislabeled |
| `/delivery-milestones` | Delivery Milestones | ⌘K | ⚠️ mislabeled |
| `/commissioning-dashboard` | Commissioning | LINK | ⚠️ mislabeled |
| `/reports/center` | Report Center | LINK | ⚠️ mislabeled |
| `/reports/performance` | Performance | LINK | ⚠️ mislabeled |
| `/reports/programme` | Programme Reports | LINK | ⚠️ mislabeled |
| `/reports/program-wide-assessment` | Program-wide Assessment | LINK | ⚠️ mislabeled |
| `/reports/pm/monthly` | PM Monthly Report | LINK | ⚠️ mislabeled |
| `/reports/engineering/monthly` | Engineering Monthly Report | LINK | ⚠️ mislabeled |
| `/reports/pm/monthly/history` | PM Report History | LINK | ok |
| `/reports/pm/monthly/compare` | PM Report Compare | **URL-ONLY** | ok |
| `/reports/engineering/monthly/history` | Engineering Report History | LINK | ok |
| `/reports/engineering/monthly/compare` | Engineering Report Compare | **URL-ONLY** | ok |
| `/ceo` | CEO Dashboard | LINK | ⚠️ mislabeled |
| `/coo` | COO Dashboard | **URL-ONLY** | ⚠️ mislabeled |
| `/leaderboard` | Leaderboard | LINK | ⚠️ mislabeled |
| `/ee-info` | Processes & SOPs | LINK | ⚠️ mislabeled |
| `/documents` | Documents | **URL-ONLY** | ⚠️ mislabeled |
| `/training` | Training | **URL-ONLY** | ⚠️ mislabeled |
| `/feedback` | Feedback & Support | **URL-ONLY** | ⚠️ mislabeled |
| `/counterparties` | Counterparties | LINK | ⚠️ mislabeled |
| `/subcontractor-dashboard` | Subcontractors | LINK | ⚠️ mislabeled |
| `/invoice-patterns` | Invoice Patterns | **URL-ONLY** | ⚠️ mislabeled |
| `/governance/financial-reviews` | Financial Review Queue | **URL-ONLY** | ⚠️ mislabeled |
| `/program/excel-vs-app` | Excel vs App | LINK | ⚠️ mislabeled |
| `/execution-dashboard` | Execution Dashboard | **URL-ONLY** | ⚠️ mislabeled |
| `/actions/launchpad` | Quick Create | **URL-ONLY** | ⚠️ mislabeled |
| `/project-create` | Create Project | LINK | ⚠️ mislabeled |

### 4.8 Detail / parameterised pages (reached by clicking a row — expected)

These are correctly reached contextually (clicking a project, client, priority,
etc.). No change needed, though their breadcrumbs depend on the parent being
reachable.

`/project/id/:projectId`, `/project/:projectName/financial-linking`,
`/project/id/:projectId/gate/:stageCode`, `/projects/:projectId/documents`,
`/projects/:projectId/revenue-tracking`, `/projects/:projectId/expenditure-breakdown`,
`/projects/:projectId/program-plan`, `/projects/:projectId/manual-overrides`,
`/projects/:projectId/excel-vs-app`, `/clients/:clientId`,
`/clients/:clientId/project/:projectId`, `/portfolios/:id`, `/priorities/:id`,
`/pd/handover/:projectId`, `/pm/on-the-go/project/:projectId`,
`/handover/:projectId/live`, `/commissioning-dashboard/:projectId`,
`/quality/ncr/:id`, `/reports/pm/monthly/:month/project/:projectId`,
`/reports/engineering/monthly/:month/project/:projectId`.

---

## 5. Role → landing → reachability (the dead-ends)

A role's landing page should always be a first-class nav destination. Today 10 of
16 roles land on a page with **no tab back to it**.

| Role(s) | Lands on | Tab back to it? |
|---|---|---|
| CEO, **COO**, Site PM, Programme Manager, Construction Manager | `/now` | ❌ none (Project Delivery tab goes to `/execution-board`) |
| CCO, Key Accounts Manager, Project Developer | `/pd` | ❌ none (no Project Development tab) |
| HSE Manager, SSEG Manager | `/hse` | ❌ none (no HSE tab) |
| CFO, Programme Finance Manager, Accountant | `/cashflow` | ✅ Finance |
| Engineering Manager, Engineer | `/engineering` | ✅ Engineering |
| Quality Manager | `/quality` | ✅ Quality |

A **Project Developer** is the sharpest example: their visible tabs resolve to
**Home + Finance only**, yet they land on `/pd` — neither tab returns them there.

---

## 6. Problems, ranked

1. **Two sources of truth.** `TOP_SECTIONS` (6) vs `PAGE_REGISTRY` (127). The nav
   renders the short list; 100 pages fall through. Every new page added to the
   registry is invisible unless someone also hand-edits `TOP_SECTIONS`.
2. **Whole domains have no entry point:** Project Development, Reports,
   Company/Portfolio, HSE, Gates, Knowledge (Training, Docs, SOPs, Leaderboard).
3. **Role-landing dead-ends** (Section 5) — including yours.
4. **Wrong active tab + mislabeled breadcrumbs** on 60 pages — "where am I / where
   did I come from" is actively wrong, not just missing.
5. **⌘K is half-blind** — filters to `showInSidebar:true`, so the fast path can't
   reach ~97 pages either.
6. **Two search surfaces** — the header box (entities) and ⌘K (pages) confuse
   "find a thing" vs "go to a screen".
7. **Admin sprawl** — 22 admin pages, 4 surfaced; the launcher was retired.

---

## 7. Proposed modern navigation

### 7.1 Principles

1. **One source of truth.** The sidebar, command palette, breadcrumbs and mobile
   nav all render from `PAGE_REGISTRY`. Add a page → it appears everywhere,
   filtered by role/lens. No more hand-maintained `TOP_SECTIONS`.
2. **A left sidebar, not 6 top tabs.** Top tabs cap out at ~7; this is an
   11-domain platform. A collapsible left rail with grouped, expandable sections
   is the standard pattern for dense ops tools (Linear, Stripe, Vercel, Azure).
3. **Personal + fast.** Pinned favourites and Recents at the top of the rail; a
   prominent, all-pages ⌘K palette as the power path.
4. **Always know where you are and how you got here.** Active state and
   breadcrumbs derive from the registry hierarchy, so they're never wrong.
5. **Role-first.** Each role sees its domains expanded and lands on a page that is
   a real, returnable nav item.

### 7.2 Information architecture (driven by existing `navGroup`)

The registry already tags every page with a `navGroup`. Group them into a
role-filtered left rail:

```
┌────────────────────────────┐
│  🔍  Search / ⌘K           │   ← one search: pages + entities + actions
├────────────────────────────┤
│  ⭐ Pinned                  │   ← user favourites
│     Now · Cashflow · …      │
│  🕘 Recent                  │   ← last visited
├────────────────────────────┤
│  🏠 Home                    │   My Work · Priorities · Inbox · Calendar · Meetings
│  🏢 Company            ▾    │   Overview · Portfolio · Lifecycle · Team
│  🧭 Project Development ▾   │   Opportunities · Clients · Sites · PD Dashboard · Handovers
│  🚧 Project Delivery   ▾    │   Now · Execution Board · All Projects · Gates ·
│                            │   Milestones · Weekly Reviews · Handover & Closeout
│  💰 Finance            ▾    │   Cashflow · COS · Revenue · GP · FYE · QuickBooks ·
│                            │   Payments · PO Approvals · Reviews
│  🔧 Engineering        ▾    │   Dashboard · Tasks · Documents · Standup
│  ✅ Quality            ▾    │   Dashboard · Tasks · Documents · Commissioning · NCRs
│  🦺 HSE                ▾    │   Dashboard · SSEG
│  📊 Reports            ▾    │   Center · Performance · PM/Eng Monthly · Programme
│  📚 Knowledge          ▾    │   Processes & SOPs · Training · Documents · Leaderboard
│  ⚙️ Settings           ▾    │   Roles · Functionality · Integrations · Audit · (admin tools…)
└────────────────────────────┘
```

- **Collapsible & icon-only mode** so it doesn't crowd dense finance/eng tables;
  state persisted per user (extend the existing `use-nav-preferences` hook).
- **Role filtering** reuses today's logic (`ROLE_VISIBLE_SECTIONS`,
  `canViewPath`, lens `allowedModules`) — just applied to the registry tree.
- The current top sub-nav pill bar becomes the **in-domain secondary nav** (e.g.
  inside a project, the project tabs from `DetailLayout`). Breadcrumbs stay in
  the header.

### 7.3 Command palette (⌘K) — the power path

- Index **all enabled pages** (drop the `showInSidebar` filter), plus entity
  search, plus quick-create actions and recents — one box.
- Make the **header search field open ⌘K** so there's a single, obvious "go
  anywhere / find anything" surface.

### 7.4 Breadcrumbs from the registry

Replace the ~250 lines of per-path logic in `getBreadcrumbs` with a generic
walk of the registry hierarchy (`navGroup` → page → detail). Detail pages keep
their dynamic labels (project name, client name). Result: the root crumb and
active section are **always correct**, including for today's 60 mislabeled pages.

### 7.5 Mobile

Keep the bottom tab bar for the top 4 destinations **by that role's usage**
(reuse `nav-analytics`), with "More" opening a sheet that mirrors the sidebar
groups — so mobile reaches everything the desktop rail does.

### 7.6 What stays

The visual system, `AppLayout` chrome, lens switcher, simulation banner,
notification bell, layout primitives (`DetailLayout`, `TableLayout`, …),
prefetch, scroll restoration, and screen-availability gating all stay. This is a
**rewire to the registry**, not a reskin.

---

## 8. Migration plan (low-risk, phased)

**Phase 0 — Quick wins (no redesign, ~½ day each):**
- Fix the role-landing dead-ends (Section 5) so no role lands on a tab-less page.
- Make ⌘K index every enabled page.
- Make breadcrumbs/active-tab fall back to the page's `navGroup` section instead
  of Home, killing the 60 mislabels.

**Phase 1 — Registry-driven sidebar (behind a rollout flag):**
- Build the left-rail nav from `PAGE_REGISTRY` + role/lens filters.
- Ship alongside the current top tabs under a flag (reuse `use-rollout-flag`);
  dogfood with the leadership lens first.

**Phase 2 — Personalisation & retire the old model:**
- Pinned favourites + Recents; per-user collapse state.
- Mobile parity; remove the hand-maintained `TOP_SECTIONS`; add a CI check that
  every `routeComponentKey` page resolves to a `navGroup` (no more orphans).

**Guardrails honoured:** registry-driven visibility keeps server-side RBAC as the
real gate (nav is presentation only); no schema/migration impact; no finance or
snapshot code touched.

---

## 9. Appendix — how this was verified

- Parsed `PAGE_REGISTRY` and `TOP_SECTIONS` directly; replicated each section's
  `match()` prefix logic to compute which tab lights up per path.
- Scanned all `client/src/**/*.{ts,tsx}` for static inbound links
  (`href="…"`, `navigate("…")`, etc.), excluding the nav-config files, to
  classify `LINK` vs `URL-ONLY`.
- Confirmed `isScreenEnabled` defaults to enabled; `settings-home.tsx` exposes 4
  cards; `GlobalCommandPalette` filters to `showInSidebar:true`; `AdminShell`
  wraps only 6 admin pages.

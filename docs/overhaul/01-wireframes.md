# 01 — Wireframes: Page Archetypes & Lens Shell

**Phase 1 deliverable (pre-code).** Concrete layout direction for the design-system phase. Nothing here is implemented yet — these are the targets the tokens + primitives must serve.

> **Status:** In progress — this artefact lands in ~6 small commits. Review at any checkpoint.
> **Date started:** 2026-04-21

---

## Direction — principles

Before any wireframe. Each principle is a hard constraint the primitives must honour.

1. **Professional, information-dense, zero decoration.** No hero banners, no decorative illustrations, no emoji, no `energy-*` animations on new surfaces. Content first, every time.
2. **Consistent chrome, per-lens content.** The shell (header, nav, breadcrumb, page header) is identical for every role; the content under it adapts to the lens.
3. **Reuse what exists.** The `ee-*` classes already in `client/src/index.css:320-394` (ee-page, ee-page-header, ee-section-title, ee-helper-text, ee-empty-state, ee-loading-state, ee-error-state, ee-chip, ee-surface-muted, ee-context-row, ee-data-trust-*) are the foundation. Phase 1 tokens + primitives **wrap** these, don't replace them.
4. **1440px max content width** (`ee-page` already sets this at `index.css:327`). Sidebar is fixed; main area scrolls.
5. **Density scales, not density maxes.** Tables are dense; forms are spacious. Same primitives, different spacing tokens.
6. **Status at a glance.** RAG state, trust envelope, approval status visible without drilling. Always use existing status primitives (`ui/status-badge.tsx`).
7. **Mobile is first-class for PM + Construction Manager + HSE lenses.** `PM On-The-Go` already exists as a discrete route — wireframes show how archetypes collapse to mobile, not separate mobile-only designs.
8. **Keyboard-navigable by default.** Every wireframe labels the primary keyboard action (Cmd-K quick-create, `/` focus search, Esc close overlays). Not aspirational — Phase 2 work enforces this per-function.
9. **Dark mode parity.** Every primitive must render correctly in `.dark`. Existing `--surface`, `--surface-strong`, `--surface-tint` tokens already have dark variants (`index.css:136-138`).
10. **No net-new visual language.** If a pattern can be expressed with an existing primitive, it must be — new primitives require explicit sign-off.

---

## Legend

Wireframes use light box-drawing characters. Conventions:

| Symbol | Meaning |
|---|---|
| `████` / `▓▓▓▓` | Filled block (logo, avatar, chart area) |
| `[ Button ]` | Button primitive (square brackets = interactive) |
| `[×]` | Icon button |
| `( option )` | Select / dropdown trigger |
| `│ text │` | Table cell / panel border |
| `· · · · ·` | Separator / divider |
| `▲ ▼` | Sort indicator |
| `•` | Status dot |
| `lorem…` | Truncation ellipsis |
| `[CFO]` | Role annotation (not rendered — wireframe-only labels) |

Dimensions are approximate. Real values come from tokens.ts in checkpoint 2.

---

## W1 — AppShell (chrome)

The frame every page renders inside. Identical for every role. Only the sidebar contents change per lens.

### Desktop (≥1024px)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ████ Emergent Energy        [ /  Search pages, projects, people…        ⌘K ]   🔔  ⚙  👤│  ← Top bar (56px)
├────────┬───────────────────────────────────────────────────────────────────────────────┤
│        │  Portfolio  ›  Gates  ›  Blocked                                               │  ← Breadcrumb (32px)
│ MY     │ ───────────────────────────────────────────────────────────────────────────── │
│  Home  │                                                                                │
│  Tasks │  Blocked Gates                                  [ Filter ] [ Export ] [+ New ] │  ← PageHeader (72px)
│  Calen │  12 projects in blocked state · updated 2 min ago                              │
│        │                                                                                │
│ PORTF  │  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  Gates │  │                                                                          │ │
│  Life  │  │                    Page content (scrollable)                             │ │  ← Main (flex-1)
│  Over  │  │                                                                          │ │
│        │  │                                                                          │ │
│ PROJ   │  │                                                                          │ │
│  Proj  │  │                                                                          │ │
│  Sites │  │                                                                          │ │
│  Clien │  │                                                                          │ │
│        │  │                                                                          │ │
│ FINAN  │  │                                                                          │ │
│  Cash  │  │                                                                          │ │
│  COS   │  │                                                                          │ │
│  Rev   │  │                                                                          │ │
│  QB    │  │                                                                          │ │
│ ·····  │  │                                                                          │ │
│ [⬅ Fold]│  └──────────────────────────────────────────────────────────────────────────┘ │
│ v1.4.2 │                                                                                │
└────────┴────────────────────────────────────────────────────────────────────────────────┘
  240px                             1200px max (within 1440px ee-page)
```

**Anatomy:**

- **Top bar (56px, sticky):** Logo (preserved verbatim — `/emergent-logo.png`, `h-7`), command palette trigger (⌘K opens the existing `Command` primitive), notifications bell, settings cog, user menu. No role switcher — role changes go through Admin.
- **Sidebar (240px fixed, collapsible to 64px):** Nav groups from `NAV_GROUP_KEYS` (§2.3 of `00-inventory.md`). Group headings are small-caps section labels (e.g. `MY`, `PORTF`, `PROJ`, `FINAN`). Collapsed state shows icons only — `matchSubRoutes` pages get active-state highlighting.
- **Breadcrumb strip (32px):** Section › page hierarchy. Always present, even on top-level pages (`Portfolio ›` for a top-level Portfolio page).
- **PageHeader (72–96px depending on actions):** Title + sub-line + trailing action buttons. Uses existing `ee-page-header` class (`index.css:330-332`). Sub-line carries the update-time / context signal.
- **Main content:** `ee-page` (max 1440px, `space-y-5`). Everything inside is page-archetype-specific.
- **Footer (sidebar-only):** Fold toggle + build version. Not full-width — keeps main area uncluttered.

**Version banner + network banner** (existing — `App.tsx:199-231`, `NetworkStatus`) stack above top bar at z-90 / z-100 when active. AppShell must reserve vertical buffer when either is visible — already handled by the existing offline-suppression logic at `App.tsx:183-195`. Do not regress.

### Mobile (<768px)

```
┌──────────────────────────────────────┐
│ ☰   ████ Emergent          🔔  👤   │  ← Top bar (48px), hamburger replaces sidebar
├──────────────────────────────────────┤
│ Gates › Blocked                     │
│                                      │
│ Blocked Gates            [ ⋯ ]      │  ← PageHeader collapses — overflow menu
│ 12 projects · 2 min ago             │
│                                      │
│  ┌────────────────────────────────┐ │
│  │                                │ │
│  │  Page content (scroll)         │ │
│  │                                │ │
│  └────────────────────────────────┘ │
│                                      │
│ ┌──┬──┬──┬──┬──┐                    │
│ │🏠│✓ │📋│📊│⋯ │                    │  ← Bottom tab bar (56px, sticky)
│ └──┴──┴──┴──┴──┘                    │
│  Home Tasks Lists Dash More         │
└──────────────────────────────────────┘
  390px
```

**Mobile differences:**

- **Sidebar → drawer** (Sheet primitive, already exists in `ui/sheet`).
- **Bottom tab bar (5 slots)** — role-adaptive. Default: Home, Tasks, Primary-List, Primary-Dashboard, More. For `PROJECT_MANAGER_SITE`, the primary-dashboard slot is `PM On-The-Go`. For `CONSTRUCTION_MANAGER`, Milestone Tracker. For `CFO`, Cashflow. Configured per-lens (see W7 checkpoint).
- **PageHeader actions → overflow menu (⋯)** once there are more than 2 trailing actions, to keep the title readable.
- **Touch targets 44px minimum** — already enforced in `index.css:305-318`.
- **Command palette (⌘K)** available via long-press on the search icon. Kept for mobile power users.

### Accessibility notes (apply everywhere)

- Top bar is `<header role="banner">`; sidebar is `<nav aria-label="Primary">`.
- Breadcrumb is `<nav aria-label="Breadcrumb">` with ordered list.
- Active nav item gets `aria-current="page"`.
- Skip-to-content link (visually hidden, visible on focus) before the sidebar.
- All icon-only buttons need `aria-label`.

---

**End of checkpoint 1.**

---

## W2 — Dashboard archetype

Used by: Company Overview, Execution Board Overview, Quality Dashboard, Engineering Dashboard, HSE Dashboard, PM Dashboard, PD Dashboard, Handover Dashboard, Gates Pipeline.

Pattern: **status strip → primary grid → secondary grid → recent activity.** The same structure across every domain, varying only in which KPIs and which widgets.

### Desktop layout — Company Overview (COO/CEO lens example)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Portfolio  ›  Company Overview                                                        │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ Company Overview                         As of 08:42 · 21 Apr 2026 [Refresh] [Export]│  ← PageHeader
│ Portfolio health across 47 active projects                                            │
│                                                                                        │
│ ┌ Status strip ──────────────────────────────────────────────────────────────────┐   │
│ │ ● 34 On track   ● 9 At risk   ● 4 Off track    Revenue MTD R 12.4M (+8%) ▲  │   │  ← KPI band (64px)
│ │ Pipeline R 48M  Backlog 3.2mo  GP margin 21%  Weekly cash need R 2.1M        │   │
│ └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│ ┌ Department health (3×2 grid) ──────────────────────────────────────────────────┐   │
│ │ ┌────────────┬────────────┬────────────┐                                       │   │
│ │ │ ENG        │ PM         │ CONSTR.    │                                       │   │
│ │ │ ● 92%      │ ● 88%      │ ⚠ 74%      │   ← Department KPI tiles             │   │
│ │ │ 23 tasks   │ 14 OOS     │ 6 incidents│      (card, status dot + headline)   │   │
│ │ │            │            │            │                                       │   │
│ │ │ [View →]   │ [View →]   │ [View →]   │                                       │   │
│ │ ├────────────┼────────────┼────────────┤                                       │   │
│ │ │ QUALITY    │ FINANCE    │ HSE        │                                       │   │
│ │ │ ● 96%      │ ● 91%      │ ● 100%     │                                       │   │
│ │ │ 2 NCRs     │ R 2.1M due │ 0 incidents│                                       │   │
│ │ │ [View →]   │ [View →]   │ [View →]   │                                       │   │
│ │ └────────────┴────────────┴────────────┘                                       │   │
│ └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│ ┌ Exceptions (primary) ──────────────┬ Recent signals (secondary) ────────────────┐  │
│ │ Needs attention               24  │ Activity feed                              │  │
│ │ ───────────────────────────────── │ ─────────────────────────────────────────  │  │
│ │ ⚠  Acme Ltd: Gate 3 blocked (3d) │ • CFO approved R 1.2M PO — 2h ago          │  │
│ │ ⚠  Solarix: NCR overdue (5d)     │ • NCR-042 closed by QM — 4h ago            │  │
│ │ ⚠  Brightside: Revenue slip      │ • Weekly review submitted — 1d ago         │  │
│ │ ⚠  Heliopolis: HSE audit due    │ • 3 new tasks imported from Smart Import   │  │
│ │ … 20 more                         │ • Gate 2 review scheduled — Fri 10am       │  │
│ │                          [See all]│                                   [See all]│  │
│ └────────────────────────────────────┴─────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ Portfolio finance (full width) ─────────────────────────────────────────────────┐  │
│ │ Rev / COS / GP monthly   [▬▬▬▬▬▬▬▬▬ Chart area ▬▬▬▬▬▬▬▬▬]  [6m ▼] [Table]    │  │
│ │                                                                                  │  │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Anatomy

- **Status strip** is a single-row KPI band using `StatusIndicator` + `StatusChip` primitives. Left cluster = portfolio state counts (on track / at risk / off track). Right cluster = 4 primary KPIs. Trailing delta arrows (▲ ▼) are `ui/status-badge` variants. No chart here — just counts and deltas.
- **Department health grid** is a responsive `md:grid-cols-3` of department-scoped KPI cards. Each card = status dot + percentage + 2-line context + link. Uses existing `DepartmentKpiTable` (`client/src/pages/company-overview/components/DepartmentKpiTable.tsx`) pattern but cardised.
- **Exceptions panel** (left, 2/3 width on desktop) lists top issues needing attention. Uses existing `ExceptionsAndPriorities` surface. Sort: severity then age. Each row clickable to the source function.
- **Recent signals** (right, 1/3 width) is an activity log. Uses `RecentSignals` component (already exists). Read-only — filtering happens at the source.
- **Full-width secondary sections** (finance chart, etc.) stack below. One chart max per section; prefer table view as default, chart as toggle.

### Behaviour rules

- **No stale data without warning.** "As of 08:42" in the PageHeader sub-line is not decorative — it's the freshness stamp that already drives `DataTrustBadge`. When data is >5 min stale, the whole status strip gets a subtle amber border and the stamp turns amber.
- **No empty dashboards.** If a role lands here with no data, show `EmptyState` with a clear "you're seeing this because…" explanation, not a blank grid.
- **Loading skeletons preserve layout.** The status strip, 6 cards, and 2 panels all have `LoadingSkeleton` variants that match their dimensions exactly — page doesn't reflow when data arrives.

### Mobile collapse

- Status strip → stacked 2×3 grid of KPIs.
- Department grid → vertical list of cards (full width).
- Exceptions + Recent signals → tabs (default: Exceptions).
- Full-width chart → swipable card with table toggle.

### Dashboard variations by lens

Every dashboard keeps the **structure** (status strip / primary grid / secondary panels / full-width). What changes is **which** KPIs and widgets:

| Lens | Dashboard | Status strip focus | Primary grid | Secondary |
|---|---|---|---|---|
| `COO_ADMIN` / `CEO_ADMIN` | Company Overview | Portfolio state + R MTD + pipeline | Department health (6) | Exceptions + signals |
| `PROGRAM_MANAGER` | Execution Board | Active projects state + milestones | Projects health grid (top 9) | Gate queue + signals |
| `CFO` / `PFM` / `Acct` | Cashflow | Cash in / cash out / balance | Monthly bucket grid | Overdue invoices + forecast |
| `ENGINEERING_MANAGER` | Engineering | Tasks by state + blocked | Task lanes (todo/doing/review/done) | Standup queue + blockers |
| `QUALITY_MANAGER` | Quality | NCR counts + inspections | Quality domain grid | Overdue NCRs + recent inspections |
| `HSE_MANAGER` | HSE | Incident counts + audit state | HSE domain grid | Open incidents + audit queue |
| `PROJECT_MANAGER_SITE` | PM Dashboard | My projects state + tasks | Per-project cards | My gate reviews + my tasks |

Same grammar, different nouns. This is what makes the platform feel consistent.

---

## W3 — List archetype

Used by: Projects, Clients, Sites, Opportunities, Gates Pipeline / Blocked / Ready / Exceptions, Lifecycle Board, Engineering Tasks, My Work Tasks, Approvals, Financial Review Queue, PO Approvals, Payment Requests, Payment Batches, Counterparties, Subcontractors, Invoice Patterns, QB Throughput tabs, Weekly Reviews.

This is the most common archetype — ~40 pages. Critical to get right.

Pattern: **toolbar → active-filter chips → dense table → pagination.** Optional: bulk-action bar (appears when rows selected).

### Desktop layout — Projects (PROGRAM_MANAGER lens)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Project Delivery  ›  Projects                                                         │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ Projects                                      47 projects  [+ New project] [Import]   │  ← PageHeader
│                                                                                        │
│ ┌ Toolbar ─────────────────────────────────────────────────────────────────────────┐ │
│ │ [ / Search name, code, client…              ]  (Status ▼) (Phase ▼) (Owner ▼) (⋯)│ │  ← Filter row
│ │                                                                                   │ │
│ │ ● Active ×  ● EPC phase ×  Owner: Anna T ×   [Clear all]        View: [Table ▼]  │ │  ← Active filter chips
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ Table ──────────────────────────────────────────────────────────────────────────┐  │
│ │ ☐ │ Code ▲ │ Name              │ Client       │ Phase       │ RAG │ Value  │ ⋯ │  │  ← Sticky header
│ │───┼────────┼───────────────────┼──────────────┼─────────────┼─────┼────────┼───│  │
│ │ ☐ │ P-0041 │ Acme Rooftop 2MW  │ Acme Ltd     │ Construction│ ●   │ R 24M  │ ⋮ │  │
│ │ ☐ │ P-0040 │ Solarix Ground    │ Solarix Pty  │ Commissioning│⚠   │ R 38M  │ ⋮ │  │
│ │ ☐ │ P-0039 │ Brightside BESS   │ Brightside   │ Engineering │ ●   │ R 12M  │ ⋮ │  │
│ │ ☐ │ P-0038 │ Heliopolis Phase2 │ Heliopolis   │ PO Approval │ ×   │ R 8.5M │ ⋮ │  │
│ │ ☐ │ P-0037 │ Nova 500kW        │ Nova Energy  │ Construction│ ●   │ R 6.2M │ ⋮ │  │
│ │ …                                                                                 │  │
│ │                                                                                   │  │
│ │ ─ 47 of 47 shown ─                                  ← 1 2 3 4 5 →  [50/page ▼] │  │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### With rows selected — bulk-action bar appears

```
│ ✓ │ Code ▲ │ Name              │ Client       │ Phase       │ RAG │ Value  │ ⋯ │
│───┼────────┼───────────────────┼──────────────┼─────────────┼─────┼────────┼───│
│ ☑ │ P-0041 │ Acme Rooftop 2MW  │ Acme Ltd     │ Construction│ ●   │ R 24M  │ ⋮ │
│ ☑ │ P-0040 │ Solarix Ground    │ Solarix Pty  │ Commissioning│⚠   │ R 38M  │ ⋮ │
│ ☐ │ P-0039 │ Brightside BESS   │ Brightside   │ Engineering │ ●   │ R 12M  │ ⋮ │

┌ Bulk-action bar (slides up from bottom, sticky) ──────────────────────────────────┐
│ 2 selected  [Reassign] [Change phase] [Export] [Archive]               [× Clear]  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Anatomy

- **Toolbar (compact, 48px):** Full-width search left (icon + `/` focus hint) → filter selects → overflow `(⋯)` for advanced filters → view toggle right. Fixed on scroll.
- **Active filter chips:** Render BELOW toolbar, not inside selects. Each chip = removable; [Clear all] on the right. This keeps the toolbar compact while making active state visible. Uses existing `ee-chip` class.
- **Table:** Sticky header (already configured at `index.css:493-501`). Row height 44px minimum. Selection checkbox first column. Sort indicators on sortable headers (`▲ ▼`). Row actions menu (`⋮`) right-most column. Uses existing `Table` primitive + `TablePagination`.
- **RAG column:** Always uses `StatusIndicator` (● ⚠ ×) with colour from `--success / --warning / --danger`. Never raw emoji or coloured text.
- **Bulk-action bar:** Sticky bottom, appears only when ≥1 row selected. Shows count + up-to-4 primary actions + [Clear]. Dangerous actions (Archive, Delete) require confirmation via `ConfirmDialog`.
- **Pagination:** Footer right. Shows "X of Y" left, page controls centre, per-page select right.

### Behaviour rules

- **Default sort is meaningful.** Projects sort by most-recently-updated desc. Gates by severity × age. Approvals by due-date asc. Never "last inserted" without reason.
- **Empty state uses `EmptyState` primitive.** Two classes: "no data anywhere" (show onboarding CTA) vs "no data matches filters" (show [Clear filters] action).
- **Column widths are stable.** Code columns are monospace, fixed width. Value columns are right-aligned, fixed width. Name columns flex. Prevents jitter on pagination.
- **Row click vs action click.** Row click opens the detail page (archetype W4). Action buttons inside a row stop propagation.
- **Virtualised for >200 rows.** Uses existing table-pagination; virtualise only when a list is known to exceed this (rare at platform scale).

### Mobile collapse

```
┌──────────────────────────────────────┐
│ Gates › Blocked                      │
│                                      │
│ Blocked Gates          [+] [⋯]      │
│                                      │
│ [ / Search…        ] (Filter)        │
│ ● Active ×  EPC ×  [Clear]          │
│                                      │
│ ┌────────────────────────────────┐  │  ← Each row becomes a card
│ │ P-0041 · ●                     │  │
│ │ Acme Rooftop 2MW               │  │
│ │ Acme Ltd · Construction        │  │
│ │ R 24M                     [⋮]  │  │
│ └────────────────────────────────┘  │
│ ┌────────────────────────────────┐  │
│ │ P-0040 · ⚠                     │  │
│ │ Solarix Ground                 │  │
│ │ Solarix Pty · Commissioning    │  │
│ │ R 38M                     [⋮]  │  │
│ └────────────────────────────────┘  │
│ …                                    │
│                                      │
│ ← 1/5 →                              │
└──────────────────────────────────────┘
```

- Table → stack of cards. Critical columns only (Code, Name, Client, Phase, Value).
- Filter becomes a sheet (Drawer primitive).
- Bulk-actions deferred on mobile — bulk selection on lists isn't a field-user flow. Row actions only.

### List variations by lens

Same primitives, different columns. `PAGE_REGISTRY` already carries the permission entity per list — the column set is configured per entity in a lookup:

| Entity | Sortable columns | Filter presets | Default sort |
|---|---|---|---|
| `projects` | Code, Name, Client, Phase, RAG, Value, Updated | Status, Phase, Owner, Client | Updated desc |
| `lifecycle` | Project, Stage, Gate state, Owner, Updated | Stage, Gate state, Blocker | Gate severity × age |
| `approvals` | Type, Project, Requested by, Due, Value | Category, Status, Due | Due date asc |
| `pd_dashboard` (Opportunities) | Name, Client, Stage, Value, Updated | Stage, Owner | Value desc |
| `eng_tasks` | Title, Project, Assignee, Stage, Due | Stage, Assignee, Priority | Due asc |
| `financial_linking` | Project, Linked line, QB ref, Status | Linked / unlinked | Unlinked first |

Configuration (not hardcoded) — lives alongside `PAGE_REGISTRY`.

---

**End of checkpoint 2.**

---

## W4 — Detail archetype

Used by: Project Detail, Client Detail, Priority Detail, Portfolio Detail, PD→PM Handover, PM Handover Review, Commissioning Dashboard (per project), Engineering Monthly Report Project, PM Monthly Report Project, Invoice Patterns detail, Counterparty detail, Opportunity detail.

Pattern: **summary header → tab row → tab content.** The summary header is sticky on scroll; the tab content is the only thing that reloads when switching tabs.

### Desktop layout — Project Detail (PROGRAM_MANAGER lens)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Project Delivery  ›  Projects  ›  Acme Rooftop 2MW                                    │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ ┌ Summary header (sticky) ─────────────────────────────────────────────────────────┐ │
│ │ Acme Rooftop 2MW                     ●  Construction    [Edit] [Share] [⋯]       │ │
│ │ P-0041  ·  Acme Ltd  ·  Anna T (PM)  ·  Johannesburg  ·  2MW                     │ │
│ │                                                                                    │ │
│ │ ┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐          │ │
│ │ │ RAG         │ Value       │ GP margin   │ Next gate   │ Go-live     │          │ │
│ │ │ ●  On track │ R 24.0M     │ 22%         │ G4 in 12d   │ 2026-08-15  │          │ │  ← Summary KPI strip
│ │ │ Updated 2h  │ +R 0.4M MTD │ +1.5pp MTD  │ ⚠ Blocked   │ (+5 days)   │          │ │
│ │ └─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘          │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ Tab row ────────────────────────────────────────────────────────────────────────┐  │
│ │ Overview │ Tasks (23) │ Finance │ Engineering │ Quality │ HSE │ Documents │ Log │  │  ← Tabs (sticky under header)
│ │ ──────── ──────────── ───────── ───────────── ───────── ───── ────────── ──── │  │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ Tab content ─────────────────────────────────────────────────────────────────────┐ │
│ │                                                                                   │ │
│ │  (Overview tab shown)                                                            │ │
│ │                                                                                   │ │
│ │  ┌ Stage timeline ──────────────────────────────────────────────────────────┐    │ │
│ │  │   G1 ──── G2 ──── G3 ──●─── G4 ───── G5 ───── G6                         │    │ │
│ │  │   ✓      ✓       ✓    ↑    ⚠ Blocked                                     │    │ │
│ │  │                     Current                                                │    │ │
│ │  └────────────────────────────────────────────────────────────────────────────┘    │ │
│ │                                                                                   │ │
│ │  ┌ Recent activity (12) ──────────┬ Open items (8) ─────────────────────────┐  │ │
│ │  │ ● CFO approved R 1.2M PO       │ ⚠ 3 tasks overdue                       │  │ │
│ │  │ ● NCR-042 closed by QM         │ ⚠ G4 blocker: roof access clearance     │  │ │
│ │  │ ● Weekly review submitted      │ ⚠ 2 deliverables pending PM review      │  │ │
│ │  │ … 9 more                       │ … 5 more                                 │  │ │
│ │  │                        [All →] │                                  [All →] │  │ │
│ │  └─────────────────────────────────┴──────────────────────────────────────────┘  │ │
│ │                                                                                   │ │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Anatomy

- **Summary header (sticky, 2 rows):** Title + state badge + trailing actions on row 1. Meta line (code, client, owner, location, size) on row 2 — comma-separated, muted. KPI strip (5 cards) below. Sticky on scroll — stays visible as user moves through tab content. Height: ~160px initially, compresses to 80px (just title + state) once scrolled.
- **Tab row:** Uses existing `Tabs` primitive. Each tab shows a count badge where meaningful (`Tasks (23)`). Tab content changes via React Router param or tab state — URL reflects active tab (`/project/acme/?tab=finance`) for deep-linking.
- **Tab content area:** Scrolls independently when tabs are sticky. Each tab is its own layout — Overview uses a 2-col split, Finance uses the List archetype (W3), Documents uses a grid, Log uses a timeline. Tabs are NOT forced into one layout.
- **Edit action:** Always top-right. Opens an inline edit state OR a Drawer (domain-specific — audited in Phase 2).

### Behaviour rules

- **State badge is always current.** Computed server-side from canonical `project_execution_state`. Never cached beyond the page's `TrustEnvelope` window.
- **Tab counts lazy-load.** The count badge uses a lightweight count query; full tab data loads only when the tab is activated.
- **URL reflects tab.** `?tab=finance` or `/project/:id/finance` — both work; the page-registry pattern decides per route.
- **Summary KPI strip never overflows.** Max 5 cards desktop, max 2×2 tablet, stacked list mobile. Choose KPIs per entity (stored in config alongside PAGE_REGISTRY).
- **"Open items" column surfaces what needs the user's action**, not everything. For PROGRAM_MANAGER on a project: overdue tasks, blocked gates, pending approvals they own. For ENGINEER: their own tasks + their standup blockers.
- **Breadcrumb shows the drill-in path.** `Section › List page › Detail title`. Always linkable up.

### Mobile collapse

```
┌──────────────────────────────────────┐
│ ‹ Back                               │
│                                      │
│ Acme Rooftop 2MW                     │
│ P-0041 · Acme Ltd                    │
│ ●  Construction                      │
│                                      │
│ ┌────────┬────────┐                  │
│ │ RAG    │ Value  │                  │  ← KPI tiles 2×2 grid
│ │ ●      │ R 24M  │                  │
│ ├────────┼────────┤                  │
│ │ Next G │ Go-live│                  │
│ │ 12d ⚠  │ Aug 15 │                  │
│ └────────┴────────┘                  │
│                                      │
│ ( Overview ▼ )                       │  ← Tabs → select dropdown
│                                      │
│ (Tab content — scrollable)           │
│                                      │
└──────────────────────────────────────┘
```

- Summary header simplified — title + state + 4-tile KPI grid.
- Tabs → select dropdown (saves horizontal space).
- Actions (Edit / Share / ⋯) move to a floating action button (FAB) bottom-right, or overflow in the header right side.

### Detail variations by entity

Same structure. Differences live in: which KPIs, which tabs, which tab default.

| Entity | Summary KPIs | Tabs |
|---|---|---|
| Project | RAG · Value · GP margin · Next gate · Go-live | Overview · Tasks · Finance · Engineering · Quality · HSE · Documents · Log |
| Client | Active projects · Total value · Stage spread · Last contact · Owner | Overview · Projects · Opportunities · Contacts · Documents · Log |
| Priority | State · Owner · Due · Impact · Linked items | Overview · Updates · Linked projects · Log |
| Portfolio | Project count · Total value · RAG spread · GP margin · Revenue MTD | Overview · Projects · Finance · Performance · Log |
| Handover (PD→PM) | Readiness % · Sign-offs · Blockers · Target date | Overview · Checklist · Finance handover · Lessons · Sign-off |
| Opportunity | Stage · Value · Probability · Close date · Owner | Overview · Contacts · Activities · Documents · Log |

---

## W5 — Form / Wizard archetype

Used by: Create Project, Weekly Reviews, PD→PM Handover sign-off, Quick Create (`/actions/launchpad`), Role creation (Admin settings), Commissioning forms, Smart Import kick-off, NCR creation, Payment Request creation, PO create.

Two sub-types:

- **Single-screen form** (most cases) — modal or inline.
- **Multi-step wizard** (Create Project, Weekly Review, PD→PM Handover, Smart Import) — for flows with distinct stages and a summary review.

### W5a — Single-screen form (inline page)

Example: New Priority.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Priorities  ›  New priority                                                   │
│ ──────────────────────────────────────────────────────────────────────────── │
│ New priority                                                                  │
│ Set a company priority and assign an owner and due date.                      │
│                                                                                │
│ ┌ Form (2/3 width) ──────────────────────────┬ Context panel (1/3) ─────────┐│
│ │                                             │                                ││
│ │ Title *                                     │ Tips                          ││
│ │ [                                    ]      │ • Keep titles under 80 chars  ││
│ │                                             │ • Link to at least one project││
│ │ Owner *                                     │                                ││
│ │ ( Select person            ▼ )              │ Related                       ││
│ │                                             │ • Active priorities: 12        ││
│ │ Due date                                    │ • Your owned: 3                ││
│ │ [ 2026-05-15        📅 ]                    │                                ││
│ │                                             │                                ││
│ │ Impact level                                │                                ││
│ │ ( ● Low  ○ Medium  ○ High  ○ Critical )     │                                ││
│ │                                             │                                ││
│ │ Description                                 │                                ││
│ │ ┌──────────────────────────────────────┐    │                                ││
│ │ │                                      │    │                                ││
│ │ │                                      │    │                                ││
│ │ └──────────────────────────────────────┘    │                                ││
│ │                                             │                                ││
│ │ Linked projects                             │                                ││
│ │ [+ Link project]                            │                                ││
│ │                                             │                                ││
│ │ ───────────────────────────────────────     │                                ││
│ │                                             │                                ││
│ │                    [Cancel]  [Save draft]  [Create priority]                ││
│ └─────────────────────────────────────────────┴────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────────┘
```

### Form anatomy rules

- **Two columns on desktop** (≥1024px): form body left (2/3), context/help panel right (1/3). Stack on mobile.
- **Required fields marked `*`.** Error messages inline below field, red `--danger`. Uses existing `react-hook-form` + Zod resolvers.
- **Disabled actions while form invalid.** Button states: default / hover / active / disabled / loading. Save button shows spinner while submitting.
- **"Save draft" always available** on multi-field forms. Drafts persist to `localStorage` keyed by route + user. Auto-recover on re-entry.
- **Cancel is always an explicit button.** Back-button browser navigation prompts if dirty (uses `ConfirmDialog`).
- **Tab order matches visual order.** Labels above inputs, not placeholder text as label (already the existing `ui/input` + `ui/label` pattern).
- **Inline validation on blur, not on keystroke.** Keystroke validation only for character limits.

### W5b — Multi-step wizard

Example: Weekly Review.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Project Delivery  ›  Weekly Reviews  ›  Week 17 2026                                 │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ Weekly Review — Week 17 (20–26 Apr 2026)                   [Save draft] [Cancel]     │
│                                                                                        │
│ ┌ Step rail ───────────────────────────────────────────────────────────────────────┐ │
│ │ ✓ Scope   ✓ Tasks   ✓ Risks   ●Finance   ○ Summary   ○ Review & submit         │ │  ← Steps (✓ done · ● current · ○ pending)
│ │ ───────── ───────── ───────── ───────── ──────────── ─────────────────          │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ Step body ──────────────────────────────────────────┬ Step help ─────────────────┐ │
│ │                                                      │                              │ │
│ │ Finance                                              │ About this step              │ │
│ │ Confirm the financial state for the selected scope.  │                              │ │
│ │                                                      │ Weekly reviews lock the      │ │
│ │ ┌ Projects in scope (3) ──────────────────────────┐ │ finance snapshot for Friday │ │
│ │ │ Acme Rooftop 2MW                                │ │ close. Edit carefully.       │ │
│ │ │   Revenue MTD       [ R 1.2M          ]         │ │                              │ │
│ │ │   Cost-to-complete  [ R 8.4M          ]         │ │ Pre-populated from           │ │
│ │ │   GP margin         22% (auto)                  │ │ normalizedRevenueLines and   │ │
│ │ │                                                  │ │ normalizedCostLines          │ │
│ │ │ Solarix Ground                                  │ │ (current effective rows).    │ │
│ │ │   Revenue MTD       [ R 2.0M          ]         │ │                              │ │
│ │ │   …                                              │ │ Keyboard                     │ │
│ │ │                                                  │ │ • Tab: next field            │ │
│ │ └──────────────────────────────────────────────────┘ │ • ⌘+S: save draft            │ │
│ │                                                      │ • ⌘+⏎: next step             │ │
│ │                                                      │                              │ │
│ │                    [‹ Back]  [Skip step]  [Next ›]  │                              │ │
│ └──────────────────────────────────────────────────────┴──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Wizard anatomy rules

- **Step rail at top**, always visible. Clickable back to any completed step. Cannot jump forward to an uncompleted step.
- **One concept per step.** Never cram two domains into one step. If Finance and Risks share a screen today, split them.
- **Help panel right-side** explains why the step matters, lists keyboard shortcuts, names the data source. Read-only.
- **Step body is the hero.** Takes visible width on standard monitors; help panel collapses to bottom on <1024px.
- **Review step before submit** — always. The last step is read-only summary + [Edit step] links. No "submit" without review.
- **Draft auto-saves every 10s** on wizards. Exposed via "Last saved 00:05 ago" label in the footer of the step rail.
- **Wizards close safely.** Cancel button prompts confirmation if any step has dirty fields. Esc key triggers the same confirm.

### Mobile collapse

- Single forms: one column, full width, stacked fields. Context panel moves below the form, or collapses to a "Help" accordion at the bottom.
- Wizards: step rail becomes horizontal scroll at top. Help panel collapses to a "ⓘ What is this step?" expandable below the step title. [‹ Back] [Next ›] are full-width buttons at bottom.

---

**End of checkpoint 3.**

---

## W6 — My Work archetype

Used by: `/my-work` (home), `/my-work/tasks`, `/my-work/calendar`, `/my-work/meetings`, `/my-work/teams`, `/my-work/email`, `/inbox`.

Pattern: **today focus → action queues → this week → supporting surfaces.** This is the personal landing for every role. Every staff member starts here when `task_management_hub` is enabled (`00b-half-built.md` top-5 finish-it candidate).

### Desktop layout — My Work home

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ My Work                                                                               │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ Good morning, Anna                              Tue 21 Apr · Week 17  [+ Quick create]│  ← PageHeader
│ 7 items for today · 2 due this week · inbox: 12 new                                   │
│                                                                                        │
│ ┌ Today's focus (primary) ──────────────────────────┬ Action queues ─────────────────┐│
│ │                                                    │                                 ││
│ │ 3 things that need you today                       │ Approvals awaiting you      4  ││
│ │ ───────────────────────────────────────────────── │ ─────────────────────────── ── ││
│ │ ●  Approve PO — Acme R 1.2M              ⏱ overdue│ Financial review             2 ││
│ │     Solar panel supply · Anna T                    │ Engineering sign-off         1 ││
│ │     [Open] [Approve inline]                        │ Handover sign-off            1 ││
│ │                                                    │                                 ││
│ │ ⚠  Review NCR-042 — Solarix            ⏱ 2h left │ Tasks due today             3 ││
│ │     Submitted by QM · PM sign-off needed           │ ─────────────────────────── ── ││
│ │     [Open]                                         │ Confirm subcontractor list  ↗ ││
│ │                                                    │ Close weekly review W17     ↗ ││
│ │ ●  Weekly review — lock by 17:00         ⏱ 4h left│ Update roof access status   ↗ ││
│ │     3 projects in scope                            │                                 ││
│ │     [Open wizard]                                  │ Meetings today              2 ││
│ │                                                    │ ─────────────────────────── ── ││
│ │                                                    │ 10:00  Ops standup          ↗ ││
│ │                                                    │ 14:30  Acme gate review     ↗ ││
│ │                                                    │                                 ││
│ └────────────────────────────────────────────────────┴─────────────────────────────────┘│
│                                                                                        │
│ ┌ This week (secondary) ──────────────────────────────────────────────────────────┐  │
│ │   Mon      Tue       Wed      Thu      Fri      Sat    Sun                     │  │
│ │ ──────── ─────── ──────── ──────── ──────── ─────── ────                       │  │
│ │          ●today                                                                   │  │
│ │  2 tasks  5 tasks  3 tasks  4 tasks  Close Friday                                │  │
│ │           1 mtg   2 mtgs   1 mtg    ↗                                            │  │
│ │                                                                                   │  │
│ │  Key: ● done   ⏱ due   ⚠ overdue                                      [Calendar →]│  │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ Supporting surfaces (tabs) ────────────────────────────────────────────────────┐   │
│ │ Recent │ Assigned to me │ Watching │ Completed │ Drafts                         │   │
│ │ ────── ───────────────── ───────── ────────── ──────                           │   │
│ │ (list of items, archetype W3 dense table)                                       │   │
│ └──────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Anatomy

- **PageHeader is personal.** "Good morning, Anna" + date + weekly summary stats. Single primary action: [+ Quick create] — opens the existing `action-launchpad` flow (⌘K also opens it). No "Edit" — My Work is a view over other canonical data, not an edit surface itself.
- **Today's focus (left, 2/3 width):** The 3–5 items that actually need action TODAY. Ranked by: overdue > due-today > due-this-week > none. Each item has inline actions where safe (Approve small POs, ack a message). Actions that need context open the source page.
- **Action queues (right, 1/3 width):** Grouped counts by action-type. Each count row links to the filtered list view (W3 List archetype).
- **This week calendar strip:** Compact 7-day horizontal strip. Each day shows count of tasks + meetings. Today highlighted. Clicking a day opens `/my-work/calendar` pre-scrolled.
- **Supporting surfaces tabs:** Recent (last 20 touches across everything), Assigned to me, Watching (items they follow), Completed (their completions this week), Drafts (saved-draft forms). Each tab is a dense W3-style list with back-link.

### Behaviour rules

- **Today's focus is computed, not user-configurable.** Ranking is fixed so users can trust what lands here. A "Show more" control expands to 5 items max.
- **Zero empty queues.** If no approvals / tasks / meetings, show one-line friendly state ("No approvals awaiting you"). Never a giant empty panel.
- **Inline actions must be safe.** Approving a PO inline works only for POs below the role's single-click threshold (defined per role). Above that, action opens the detail page with the approval dialog pre-triggered.
- **Real-time freshness.** My Work polls every 60s for new action queue counts; Today's focus updates on TanStack Query invalidation when any source action completes.
- **Mute / snooze.** Each Today's focus item has a "Snooze 1h / until tomorrow" control in its row overflow. Snooze state stored server-side per user.
- **Mobile-first priority.** This page is the most-visited route across every role — PM On-The-Go already proves field-users need it on phone.

### Mobile collapse

```
┌──────────────────────────────────────┐
│ ☰   My Work          [+] [⋯]         │
│                                      │
│ Good morning, Anna                   │
│ 7 items · 2 due · inbox 12           │
│                                      │
│ ── Today ─────────────────────       │
│ ┌────────────────────────────────┐  │
│ │ ●  Approve PO — Acme R 1.2M    │  │
│ │    ⏱ overdue                   │  │
│ │    [Approve]  [Open]           │  │
│ └────────────────────────────────┘  │
│ ┌────────────────────────────────┐  │
│ │ ⚠  Review NCR-042              │  │
│ │    ⏱ 2h left                   │  │
│ │    [Open]                      │  │
│ └────────────────────────────────┘  │
│                                      │
│ ── Queues ────────────────────       │
│ Approvals (4)        →               │
│ Tasks due today (3)  →               │
│ Meetings today (2)   →               │
│                                      │
│ ── This week ─────────────────       │
│ [Horizontal scroll day strip]        │
│                                      │
│ ── Recent ────────────────────       │
│ (card list)                          │
└──────────────────────────────────────┘
```

- Single column, stacked sections.
- Today's focus = vertical cards. No side-by-side with queues.
- Queues = simple list with count + arrow.
- Tabs at bottom become a single "Recent" list by default; other tabs accessible via overflow.

### My Work per-lens specialisations

The **structure** is identical for every role. What varies:

- **Today's focus ranking** — what counts as "your focus today". Approval-heavy roles (CFO, COO) see approvals first; field roles (PM, CM) see site tasks first; engineering roles see blockers first.
- **Action queues shown** — only surface queues the role has items in. Engineer without approvals → no approvals queue card.
- **Quick create menu** — contents adapt to edit rights. Engineer → [New task] [New blocker]; CFO → [New approval] [New journal entry].

Full specialisation table for checkpoint 5 (W7 Lens-switching).

---

**End of checkpoint 4.**

---

## W7 — Lens-switching (side-by-side)

Same AppShell, three different lenses. This is the proof that "role-based lens" in this codebase means **sidebar + landing + Today's focus vary; chrome does not.**

Shown: `PROGRAM_MANAGER`, `ENGINEER`, `CFO`. The three are chosen because they're the extremes — PM is cross-cutting (Tier 1), Engineer is narrow-depth (Tier 2), CFO is narrow-horizontal-finance-only (Tier 1).

### Sidebar comparison

```
┌ PROGRAM_MANAGER ──────┐  ┌ ENGINEER ─────────────┐  ┌ CFO ──────────────────┐
│                       │  │                       │  │                       │
│ MY                    │  │ MY                    │  │ MY                    │
│   Home                │  │   Home                │  │   Home                │
│   Tasks               │  │   Tasks               │  │   Tasks               │
│   Calendar            │  │   Calendar            │  │   Calendar            │
│   Meetings            │  │                       │  │   Meetings            │
│   Teams Chat          │  │                       │  │                       │
│                       │  │                       │  │                       │
│ PORTFOLIO             │  │                       │  │ PORTFOLIO             │
│   Company Overview    │  │                       │  │   Company Overview    │
│   Lifecycle Board     │  │                       │  │                       │
│                       │  │                       │  │                       │
│ PRIORITIES            │  │                       │  │ PRIORITIES            │
│   Priorities          │  │                       │  │   Priorities (view)   │
│                       │  │                       │  │                       │
│ GATES                 │  │                       │  │                       │
│   Gates Pipeline      │  │                       │  │                       │
│   Blocked             │  │                       │  │                       │
│   Ready               │  │                       │  │                       │
│   Exceptions          │  │                       │  │                       │
│   Client Updates      │  │                       │  │                       │
│   Handover Queue      │  │                       │  │                       │
│   Open Queries        │  │                       │  │                       │
│   Commitments         │  │                       │  │                       │
│                       │  │                       │  │                       │
│ PROJECTS              │  │                       │  │                       │
│   Project List        │  │                       │  │                       │
│   Sites               │  │                       │  │                       │
│   Clients             │  │                       │  │                       │
│                       │  │                       │  │                       │
│ PROJECT DELIVERY      │  │                       │  │                       │
│   Execution Board     │  │                       │  │                       │
│   PM Dashboard        │  │                       │  │                       │
│   Milestone Tracker   │  │                       │  │                       │
│   Approvals           │  │                       │  │                       │
│   Financial Reviews   │  │                       │  │                       │
│   Handover Control    │  │                       │  │                       │
│   Handover & Closeout │  │                       │  │                       │
│   Portfolios          │  │                       │  │                       │
│   PO Approvals        │  │                       │  │                       │
│   Payment Requests    │  │                       │  │                       │
│   Payment Batches     │  │                       │  │                       │
│                       │  │                       │  │                       │
│ FINANCE               │  │                       │  │ FINANCE               │
│   Cashflow (view)     │  │                       │  │   Cashflow            │
│   COS (view)          │  │                       │  │   COS                 │
│   Revenue (view)      │  │                       │  │   Revenue             │
│   QB Throughput (view)│  │                       │  │   QB Throughput       │
│                       │  │                       │  │                       │
│ ENGINEERING           │  │ ENGINEERING           │  │                       │
│   Dashboard (view)    │  │   Dashboard           │  │                       │
│   Task Board          │  │   Task Board          │  │                       │
│   Standup             │  │   Standup             │  │                       │
│                       │  │                       │  │                       │
│ QUALITY               │  │                       │  │                       │
│   Dashboard (view)    │  │                       │  │                       │
│   Commissioning (view)│  │                       │  │                       │
│                       │  │                       │  │                       │
│ HSE                   │  │                       │  │                       │
│   HSE (view)          │  │                       │  │                       │
│                       │  │                       │  │                       │
│ REPORTS               │  │                       │  │ REPORTS               │
│   Programme Reports   │  │                       │  │   Programme Reports   │
│   PM Monthly Report   │  │                       │  │   PM Monthly Report   │
│   Eng Monthly Report  │  │                       │  │   Eng Monthly Report  │
│                       │  │                       │  │                       │
│ KNOWLEDGE             │  │ KNOWLEDGE             │  │ KNOWLEDGE             │
│   Processes & SOPs    │  │   Processes & SOPs    │  │   Processes & SOPs    │
│                       │  │                       │  │                       │
│ [⬅ Fold]              │  │ [⬅ Fold]              │  │ [⬅ Fold]              │
└───────────────────────┘  └───────────────────────┘  └───────────────────────┘
      42 items                    7 items                  16 items
```

The Program Manager lens is the **largest feasible sidebar** (42 items across 8 groups — near the cognitive ceiling). The Engineer lens is the **smallest practical one** (7 items across 2 groups). The CFO lens is **focused** (16 items, finance-heavy).

### Landing page differences

| Role | Landing route | Rationale |
|---|---|---|
| `PROGRAM_MANAGER` | `/execution-board` | Cross-cutting; sees every active project state at a glance |
| `ENGINEER` | `/engineering` | Domain home; task-first workflow |
| `CFO` | `/cashflow` | The single financial surface they own edit on |

### Today's focus differences (W6)

Same archetype, different ranking + default queues:

| Role | Today's focus top-3 example | Queues shown |
|---|---|---|
| `PROGRAM_MANAGER` | 1. Blocked gate: Acme G4<br>2. Handover sign-off: Solarix<br>3. 3 weekly reviews pending | Gates · Approvals · Tasks · Meetings |
| `ENGINEER` | 1. Blocker from standup: panel spec<br>2. Task due: design review<br>3. Review PR (if flag enabled) | Tasks · Blockers · Standup · Meetings |
| `CFO` | 1. Approve R 5M+ payment batch<br>2. Lock weekly finance<br>3. Review overdue invoices | Approvals · Finance alerts · Meetings |

### Quick-create menu differences

Opens from ⌘K / [+]. Contents = actions the role can actually take:

| Role | Quick-create options |
|---|---|
| `PROGRAM_MANAGER` | New project · New priority · New approval · New weekly review · New gate query · New commitment |
| `ENGINEER` | New engineering task · New blocker · Log hours |
| `CFO` | New approval · New journal entry · New payment request |
| `COO_ADMIN` / `CEO_ADMIN` | (All options — no filtering) |

### Mobile bottom-tab specialisation

(W1 showed the structure. Contents per lens:)

| Role | Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
|---|---|---|---|---|---|
| `PROGRAM_MANAGER` | Home | Tasks | Gates | Execution Board | More |
| `PROJECT_MANAGER_SITE` | Home | Tasks | Milestones | **PM On-The-Go** | More |
| `CONSTRUCTION_MANAGER` | Home | Tasks | Milestones | HSE | More |
| `CFO` / `PFM` / `Acct` | Home | Tasks | Cashflow | Approvals | More |
| `ENGINEERING_MANAGER` | Home | Tasks | Eng Board | Standup | More |
| `ENGINEER` | Home | Tasks | Eng Board | Standup | More |
| `QUALITY_MANAGER` | Home | Tasks | Quality | Approvals | More |
| `HSE_MANAGER` | Home | Tasks | HSE | Quality | More |
| `CCO` / `KAM` / `PD` | Home | Tasks | Opportunities | PD Dashboard | More |
| `COO_ADMIN` / `CEO_ADMIN` | Home | Tasks | Company | Gates | More |

### What does NOT change across lenses

Deliberate. Consistency is the point.

- AppShell chrome (top bar, breadcrumb strip, PageHeader).
- All primitive components (Button, Table, Tabs, Dialog, etc.).
- Tone (professional, dense, zero decoration).
- Semantics (status colours, shortcut keys).
- Brand.
- Motion + reduced-motion behaviour.
- Dark mode.
- Accessibility landmarks.

If a CFO and an Engineer opened the same project detail page, they would see the same layout. Only the **available actions** on it would differ — ruled by `evaluateEntityAccess`, not by visual template swapping.

---

**End of checkpoint 5.**

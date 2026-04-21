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

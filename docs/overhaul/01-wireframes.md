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

**End of checkpoint 1.** Next: W2 Dashboard archetype + W3 List archetype.

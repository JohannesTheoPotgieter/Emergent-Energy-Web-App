# 01 — Design System

**Phase 1 primary deliverable.** The formal documentation of the design tokens, primitives, layout primitives, data-access primitives, and usage rules for the overhaul.

> **Status:** In progress — sections land in 5 small commits.
> **Companion artefact:** `01-wireframes.md` (layout direction, approved 2026-04-21).
> **Rule:** this design system **wraps** the existing shadcn/ui substrate at `client/src/components/ui/`. It does not replace it. Migration is opt-in per screen in Phase 3.

---

## §1 Tokens

Design tokens are the single source of truth for colour, spacing, typography, layout dimensions, radius, shadow, z-index, and motion.

Implemented in `client/src/design/tokens.ts`. This TypeScript module is a **mirror** of the CSS custom properties in `client/src/index.css`. CSS variables remain the runtime authority — tokens reference them via `hsl(var(--x))` so light/dark mode, theme overrides, and future per-tenant branding work automatically.

### §1.1 Where to use tokens vs Tailwind vs raw CSS

Three layers of styling coexist. Pick the right one:

| Use case | Use this |
|---|---|
| Component styling (margins, padding, colour, typography) | **Tailwind utility classes** (`text-foreground`, `p-4`, `bg-muted`) |
| Programmatic style values in TS (row heights, chart dimensions, motion durations) | **`tokens.ts` imports** (`import { layout, motion } from "@/design/tokens"`) |
| New CSS custom properties | **`index.css` :root + .dark**, then mirror in `tokens.ts` |
| Inline style overrides | **Avoid.** Only for computed dynamic values; never static. |

Never hand-pick a hex value in a component. Never invent a new shadow. If you need something the tokens don't expose, add it to tokens.ts + index.css with explicit sign-off.

### §1.2 Token categories

The module exposes seven categories. Summary — full table per token in `tokens.ts` source.

#### Brand (fixed)

Extracted verbatim from Phase 0 brand audit. Not theme-able.

- `brand.primary` = `#16A34A` (emerald-600)
- `brand.accent` = `#22C55E` (emerald-500)
- `brand.logo` = `/emergent-logo.png` (800×202 PNG)

Never override. Logo is preserved exactly per overhaul rule.

#### Colours (theme-aware)

Wrap `hsl(var(--x))` — light/dark both work. Semantic names only (`primary`, `success`, `warning`, `danger`, `info`, `muted`) — no "red-500" style names. Use `colors.success` never a raw HSL value.

Surface ladder for layered backgrounds:

- `colors.background` — page background
- `colors.card` — elevated card / panel
- `colors.surface` — subtle tint below background
- `colors.surfaceStrong` — stronger tint
- `colors.surfaceTint` — brand-tinted surface (used sparingly)

#### Spacing (4px scale)

Matches Tailwind's default. Exposed in TS for programmatic needs (virtualised list row heights, chart margins, etc.). Prefer Tailwind classes (`p-4`, `gap-3`) in JSX.

#### Layout (AppShell canonical dimensions)

Fixed dimensions the AppShell primitive uses:

- `layout.topBarHeight` = 56px (desktop) / 48px (mobile)
- `layout.sidebarWidth` = 240px expanded / 64px collapsed
- `layout.bottomTabBarHeight` = 56px
- `layout.pageMaxWidth` = 1440px (matches `.ee-page`)
- `layout.pageHeaderHeight.{compact, default, withKpi}` = 64 / 96 / 160px
- `layout.minTouchTarget` = 44px (WCAG AA)

Changing these is an AppShell-level decision — do not tweak ad-hoc per page.

#### Typography

- Family: Inter (sans) · Barlow (heading) · JetBrains Mono (mono) — from Phase 0, not changeable.
- Size scale: 12 / 13 / 14 / 16 / 18 / 20 / 24px.
- Base body size is **14px** (`base`) — the platform defaults to dense. Forms use `md` (16px), headings use 18–24px.
- Line heights tuned for dense tables: `normal = 1.4`, `tight = 1.2`, `relaxed = 1.5`.
- Tabular numerals are default on money/metric columns (Tailwind `tabular-nums`).

#### Radius, shadow

Radius: `sm / md / lg (default 0.5rem) / xl / 2xl / full`. Shadow: `xs / sm / md`. **These six values are the whole menu.** Never `shadow-lg` inline.

#### Z-index

Predetermined stacking contexts — never hand-picked:

| Token | Value | Use |
|---|---|---|
| `base` | 0 | Page content |
| `sticky` | 10 | Sticky table header, sticky summary header |
| `shell` | 40 | Sidebar, AppShell chrome |
| `stickyBottom` | 50 | Bulk-action bar |
| `overlay` | 60 | Popover, dropdown, tooltip |
| `dialogBackdrop` | 80 | Dialog backdrop |
| `dialog` | 81 | Dialog surface |
| `drawer` | 85 | Drawer surface |
| `versionBanner` | 90 | App.tsx version-update banner |
| `toast` | 100 | Toast |
| `networkStatus` | 100 | Offline banner (must co-exist with version banner — see App.tsx:178-185) |

Never invent a z-index. If the layer you need isn't listed, the composition is wrong.

#### Motion

Respect `prefers-reduced-motion` (already wired at `index.css:667-681, 898-910`).

Durations:
- `instant` 0ms · `fast` 100ms · `base` 150ms · `moderate` 200ms · `slow` 300ms · `slower` 400ms

Easings:
- `standard` `cubic-bezier(0.16, 1, 0.3, 1)` (default)
- `smooth` `ease-out` (hover/focus)
- `exit` `ease-in` (fade-out)

**Approved motion patterns:**

| Pattern | Duration | Easing | Use |
|---|---|---|---|
| Fade in | `base` | `standard` | New item in a list |
| Slide up/down | `moderate` | `standard` | Bulk-action bar appear/dismiss |
| Scale in | `base` | `standard` | Dialog, popover |
| Skeleton shimmer | `slower` (loop) | linear | Loading state |

No bounce, no overshoot, no rotation-based decoration. No parallax.

### §1.3 Design-token checklist for new code

Before shipping a change:

- [ ] No raw hex values (except brand fixed).
- [ ] No raw HSL values.
- [ ] No hand-picked z-index.
- [ ] No motion duration in milliseconds that isn't in `motion.duration`.
- [ ] No shadow that isn't in `shadow`.
- [ ] Colour tokens are semantic (`success`, `muted`), not raw (`emerald-500`).
- [ ] Dark mode still works (toggle `.dark` on `<html>` and visual-check).
- [ ] `prefers-reduced-motion: reduce` still works (system setting + refresh).

---

**End of §1.**

---

## §2 Primitives — audit + usage rules

56 primitive files exist in `client/src/components/ui/`. This section groups them by role, states the **one canonical use** for each, and flags the gaps.

**Rule of the whole section:** do NOT create a new primitive if an existing one fits. If you think one doesn't fit, flag it here first — don't silently hand-roll a replacement. (This is how StatusBadge and RAGBadge duplicated — see `backlog.md` #2 and #3.)

### §2.1 Inputs & form

| Primitive | File | Canonical use | Common mistake |
|---|---|---|---|
| `Button` | `ui/button.tsx` | All interactive affordances. Variants: `default` (primary), `secondary`, `ghost`, `destructive`, `outline`, `link`. | Don't style `<a>` or `<div>` as button-like — always use `Button` with `asChild` + wrap. |
| `Input` | `ui/input.tsx` | Text input. | Don't set `type="date"` — use the Calendar+Popover pattern (see §2.1.1). |
| `Textarea` | `ui/textarea.tsx` | Multi-line text. | Don't use for single-line — choose `Input`. |
| `Select` | `ui/select.tsx` | Single-select from ≤12 static options. | Don't use for searchable lists — use `SearchableSelect`. Don't nest in tables. |
| `SearchableSelect` | `ui/searchable-select.tsx` | Single-select with filter when options >12 or dynamic. | Canonical for all role, project, and owner pickers. |
| `Checkbox` | `ui/checkbox.tsx` | Boolean. Also row selection in tables. | Always pair with `Label`. |
| `RadioGroup` | `ui/radio-group.tsx` | Single-choice from ≤5 mutually exclusive options. | >5 options → `Select`. |
| `Switch` | `ui/switch.tsx` | Immediate toggle (feature on/off). | NOT for form fields that submit — use `Checkbox`. |
| `Slider` | `ui/slider.tsx` | Continuous numeric ranges. | Rare in this platform. Prefer `Input type="number"` for precise values. |
| `Toggle` | `ui/toggle.tsx` | Press-to-toggle single buttons (e.g. view mode toggles). | Different from `Switch` — used for toolbar segment-style controls. |
| `Label` | `ui/label.tsx` | Label element for all form inputs. Pairs with `htmlFor`. | Mandatory — never leave an input unlabelled. |
| `Form` + hooks | `ui/form.tsx` | `react-hook-form` + `@hookform/resolvers` + Zod integration. | All forms use this composition. Don't hand-roll validation. |
| `Kbd` | `ui/kbd.tsx` | Keyboard shortcut display inside UI (⌘K, Esc). | Use throughout — keyboard-first platform. |

#### §2.1.1 DateInput — composition pattern (no dedicated primitive)

No `DateInput` primitive. Canonical composition: `Popover` + `Calendar` + `Input` (readonly display).

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Input readOnly value={formatDate(value)} placeholder="Pick a date" />
  </PopoverTrigger>
  <PopoverContent>
    <Calendar mode="single" selected={value} onSelect={onChange} />
  </PopoverContent>
</Popover>
```

Gap flagged: a typed `DateInput` + `DateRangeInput` wrapper to enforce this pattern. **Action:** add to `backlog.md` as S3 — build in Phase 3 when the first form that needs it gets touched.

#### §2.1.2 NumberInput — gap

Monetary inputs currently use `<Input type="number">` with ad-hoc formatting. No canonical `NumberInput` / `MoneyInput` primitive.

**Action:** add to `backlog.md` — build in Phase 3 for the first finance form that gets touched. Must: tabular-nums, thousands separator on blur, Rands formatting (`R 1,234.56`), paste-cleaning of currency symbols.

### §2.2 Feedback & status

| Primitive | File | Canonical use |
|---|---|---|
| `Badge` | `ui/badge.tsx` | Compact label (count, tag). Not for status — use `StatusBadge`. |
| `StatusBadge` / `RagBadge` | `ui/status-badge.tsx` | RAG / status semantic badge (dot + chip + pill variants per wireframes W-C3). |
| `StatusChip` | `ui/status-chip.tsx` | Filter chip in toolbars. |
| `MaturityBadge` | `ui/maturity-badge.tsx` | Lifecycle / stage maturity (pre-alpha / beta / GA) — domain-specific. |
| `DataTrustBadge` | `ui/data-trust-badge.tsx` | Data freshness / canonical trust envelope (W-C4). Required on finance pages. |
| `Alert` | `ui/alert.tsx` | Inline notification inside a page region. |
| `AlertDialog` | `ui/alert-dialog.tsx` | Destructive-action confirmation (delete/archive). |
| `ConfirmDialog` | `ui/confirm-dialog.tsx` | General confirmation. Preferred over raw `Dialog` for yes/no interactions. |
| `Toast` / `Toaster` | `ui/toast.tsx`, `ui/toaster.tsx` | Transient success/error notifications. |
| `Sonner` | `ui/sonner.tsx` | Sonner-based alternative toast. **Pick one per session** — don't mix. Current convention: `Toast` via `useToast()` hook. |
| `Progress` | `ui/progress.tsx` | Determinate progress bar (file upload, wizard step %). |
| `Spinner` | `ui/spinner.tsx` | Indeterminate small loader. |
| `EnergyLoader` | `ui/energy-loader.tsx` | Domain-specific branded loader. Use only on page-level loads, not inline. |
| `LoadingState` | `ui/loading-state.tsx` | Skeleton variants matching archetype dimensions (cards, tables, etc.). |
| `Skeleton` | `ui/skeleton.tsx` | Low-level skeleton block. Compose into `LoadingState` rather than using direct. |
| `EmptyState` | `ui/empty-state.tsx` + `ui/empty.tsx` | Per wireframe W-C2. Prefer `empty-state.tsx`. Two files = duplication — see §2.5. |
| `PageStates` | `ui/page-states.tsx` | Page-level loading / error / empty orchestrator. |

**Toast vs Alert vs Dialog decision:**

- **Toast** — transient, dismissable, doesn't block work. Success + error feedback for completed actions.
- **Alert** — persistent, contextual, inside a page region. Warning or info tied to a specific data state.
- **ConfirmDialog / AlertDialog** — modal, blocks work. Destructive or state-changing confirmations.

### §2.3 Overlay & navigation

| Primitive | File | Canonical use |
|---|---|---|
| `Dialog` | `ui/dialog.tsx` | Modal overlay for complex content (forms, multi-step). |
| `Drawer` | `ui/drawer.tsx` | Bottom-anchored overlay on mobile. Desktop: slides from right. |
| `Sheet` | `ui/sheet.tsx` | Side-anchored overlay (mobile sidebar, filter panel). |
| `Popover` | `ui/popover.tsx` | Floating overlay pinned to a trigger. Contents can be interactive. |
| `Tooltip` | `ui/tooltip.tsx` | Read-only hover hint. Never put interactive content inside. |
| `DropdownMenu` | `ui/dropdown-menu.tsx` | Action menu attached to a trigger. Row-action `⋮`, user menu, overflow `⋯`. |
| `Command` | `ui/command.tsx` | Cmd-K palette + any search-in-list UI. Canonical for quick-create / search. |
| `Breadcrumb` | `ui/breadcrumb.tsx` | Section › Page › Detail trail (W1). Always render even on top-level. |
| `Tabs` | `ui/tabs.tsx` | Switching content within a page context (W4 Detail archetype). |
| `Collapsible` | `ui/collapsible.tsx` | Accordion-style expand/collapse. Substitutes for a dedicated `Accordion`. |
| `Sidebar` | `ui/sidebar.tsx` | Primitive for AppShell sidebar composition. |

**Dialog vs Drawer vs Sheet decision:**

- **Dialog** — centred modal. Form with ≤6 fields; confirmations; detail peek.
- **Drawer** — bottom on mobile / right on desktop. Form with >6 fields; mobile actions; contextual detail that coexists with background.
- **Sheet** — left or right side panel. Filter panel; navigation drawer on mobile; secondary workflows.

### §2.4 Layout & data display

| Primitive | File | Canonical use |
|---|---|---|
| `Card` | `ui/card.tsx` | Content container. Default layout unit below page-level sections. |
| `Separator` | `ui/separator.tsx` | Horizontal / vertical divider. |
| `ScrollArea` | `ui/scroll-area.tsx` | Scoped scroll containers (sidebar, tabs content). |
| `AspectRatio` | `ui/aspect-ratio.tsx` | Aspect-locked containers (rare — charts, images). |
| `Avatar` | `ui/avatar.tsx` | User / entity avatar. |
| `Table` | `ui/table.tsx` | Data table base. Use with `TablePagination` always. |
| `TablePagination` | `ui/table-pagination.tsx` | Table pagination footer — mandatory on tables >25 rows. |
| `FinancialDataGrid` | `ui/financial-data-grid.tsx` | Money-dense tables. Tabular-nums by default, right-aligned columns. |
| `ExportDropdown` | `ui/export-dropdown.tsx` | CSV / XLSX / PDF export menu — canonical for all list/report exports. |
| `Chart` | `ui/chart.tsx` | Chart primitives (line, bar, area). Minimal decoration. Always provide table-toggle. |
| `Calendar` | `ui/calendar.tsx` | Date picker base (paired with Popover — see §2.1.1). |
| `Pagination` | `ui/pagination.tsx` | Non-table pagination. Rare — prefer `TablePagination` even for card-list views. |
| `Carousel` | `ui/carousel.tsx` | Horizontal scroll — mobile card sliders only. Desktop should not use. |
| `PageHeader` | `ui/page-header.tsx` | Canonical PageHeader component (W-C1). Use on every page. |

### §2.5 Identified duplicates / gaps

These are already in `backlog.md`, reiterated here for design-system clarity:

| Issue | Current state | Resolution in overhaul |
|---|---|---|
| `components/StatusBadge.tsx` wraps `ui/status-badge.tsx` | Legacy import path | Phase 3 — migrate call-sites as each page is touched |
| `components/reports/RAGBadge.tsx` duplicates `RagBadge()` from `ui/status-badge.tsx` | Hand-rolled | Phase 3 — migrate on first report-page touch |
| `ui/empty.tsx` and `ui/empty-state.tsx` | Two files | Prefer `empty-state.tsx`; `empty.tsx` call-sites audited in Phase 3 |
| `DateInput` / `DateRangeInput` composition | Repeated inline | Add primitive in Phase 3 on first form that needs it |
| `NumberInput` / `MoneyInput` | `<Input type="number">` + ad-hoc | Add primitive in Phase 3 on first finance form touch |
| `Accordion` | Use `Collapsible` | No action — `Collapsible` suffices. Document this mapping in code comments. |
| `EnergyLoader` branding vs neutral `Spinner` | Both exist | `Spinner` for inline / secondary; `EnergyLoader` for full-page initial load only |

### §2.6 The "don't build this" list

Things that would tempt a contributor to create a new primitive. The answer is always "use the existing composition":

| Temptation | Use instead |
|---|---|
| `StatPill` | `StatusBadge` pill variant |
| `InfoBox` | `Alert` with `variant="default"` |
| `RoundedCard` | `Card` (radius is already token-controlled) |
| `IconButton` | `Button variant="ghost" size="icon"` |
| `ColourPicker` | Not needed — brand colours are fixed |
| `ToastQueue` | `Toaster` manages queue already |
| `ModalTabs` | `Dialog` + `Tabs` composition |
| `ScrollableList` | `ScrollArea` + list |

If the composition doesn't exist in shadcn/ui conventions, flag to backlog — don't invent.

### §2.7 Accessibility baseline

All primitives must meet these minima. Audited during Phase 3 per-screen touches.

- **Keyboard-navigable.** Focus ring visible (via `focus-visible`). Tab order matches visual order.
- **Screen-reader labels.** Icon-only controls need `aria-label` or `sr-only` text.
- **Colour + symbol.** No colour-only signal (RAG uses dot+colour, never colour alone).
- **Minimum touch target.** 44px (already enforced at `index.css:305-318`).
- **Reduced-motion honoured.** Any animation must respect `prefers-reduced-motion: reduce`.
- **Dark mode parity.** Every primitive tested in `.dark`.

---

**End of §2.** Next: §3 — Layout primitives plan.

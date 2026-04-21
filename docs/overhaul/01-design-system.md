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

**End of §1.** Next: §2 — Primitives audit + usage rules.

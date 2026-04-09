# Emergent Energy (EE) Design System

## Design direction
- Clear, simple, modern, professional UI language.
- Minimal shell chrome (navigation/header/card framing).
- Dense, efficient work surfaces (tables/boards/forms) for operational speed.

## Token definitions
Defined in `client/src/index.css`.

### Color tokens
- `--background`, `--foreground`
- `--card`, `--card-foreground`
- `--primary`, `--primary-foreground` (EE green)
- `--secondary`, `--muted`, `--accent`
- `--border`, `--input`, `--ring`
- semantic support: `--success`, `--warning`, `--danger`, `--info`

### Typography scale
- Headings: `h1`/`h2`/`h3` normalized in base layer.
- Body defaults to Inter with strong readability and restrained contrast.
- Table headers standardized to uppercase dense labels.

### Spacing scale
- Shell spacing via `.ee-page` and `.ee-page-header`.
- Card/content spacing standardized to `p-4` default.
- Dense work controls use `h-8` / `h-9` inputs and compact chips.

### Radius and shadows
- Base radius: `--radius: 0.625rem`.
- Shared shadows: `--shadow-xs`, `--shadow-sm`, `--shadow-md`.

## Component standards

### Shell/layout
- `.ee-shell` for app chrome background.
- `.ee-page` for page max width and vertical rhythm.
- `.ee-page-header` for consistent top-of-page hierarchy.

### Cards
- Light border + subtle shadow only (`shadow-xs`).
- No heavy gradients/noisy cards.

### Buttons hierarchy
- Primary: `variant=default` (green).
- Secondary/quiet: `outline`, `ghost`, `secondary`.
- Destructive isolated to true destructive actions.

### Form states
- Inputs/Textareas use border + ring focus pattern with `ring/30`.
- Disabled states keep contrast but lower prominence.

### Tables (dense work view)
- Compact row/cell heights.
- Sticky readable headers with muted background.
- Hover feedback subdued and consistent.

### Badges/chips/status
- `Badge` variants: `default`, `secondary`, `outline`, `destructive`, `success`, `warning`, `info`.
- RAG and queue states mapped to restrained red/amber/green semantics.

### Modal/drawer
- Unified overlay intensity.
- Consistent border, radius, and shadow profile.

### Empty/loading/error states
- `.ee-empty-state`, `.ee-loading-state`, `.ee-error-state` utility components/classes.

## Updated pages/components
- App shell/navigation (`AppLayout`).
- Home/dashboard shell and card/action styling.
- Program dashboard shell density and filter chips.
- Shared primitives (`button`, `card`, `input`, `textarea`, `table`, `badge`, `dialog`, `sheet`, `page-shell`).

## Before/after rationale
- Before: multiple one-off spacings, mixed border radii, inconsistent surface density, and accent usage drift.
- After: tokenized foundation + consistent primitives; shell is quieter, while work surfaces remain compact and fast.

## QA checklist
- [ ] App shell spacing and nav states are visually consistent.
- [ ] Buttons hierarchy is predictable across pages.
- [ ] Form fields share the same focus/disabled behavior.
- [ ] Table density and headers are consistent.
- [ ] Badge/status semantics are consistent and readable.
- [ ] Dialog/sheet overlays and panel styles are aligned.
- [ ] Home/dashboard/project pages maintain responsive usability.
- [ ] No visual regressions in major operational workflows.

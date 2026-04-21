# 00 — Function Inventory

**Phase 0 deliverable.** Read-only discovery pass. No code was modified to produce this.

> **Status:** Draft — §1 scope, lens, brand. §§2–5 appended in subsequent checkpoints.
> **Date started:** 2026-04-21

---

## §1.1 Scope & method

This artefact is the spine for the full Phase 0–4 overhaul. It records what exists today, per function, per role — so later phases can change visual and add functionality **without removing anything that's live**.

**In scope:**

- Every entry in `client/src/config/page-registry.ts` (the authoritative frontend route registry).
- Every server route file — both the 16 new `server/routes/*.routes.ts` and the 57 legacy `server/*-routes.ts`.
- Every `COMPANY_ROLES` entry (16 roles — see `shared/schema/users.ts:77-95`).
- Brand assets as rendered today (hex values extracted; logo path recorded).
- Top-level shape of `client/src/components/` (primitives vs feature modules).

**Out of scope for Phase 0** (and explicitly deferred):

- Per-page visual audit at pixel level. Pages are enumerated here; detailed per-page visual-state notes happen in Phase 2 (`02-function-plan.md`) as each function is planned.
- Per-endpoint behaviour walk for 73 server route files. The route **inventory** is produced in §3; per-endpoint behaviour contract is recorded in Phase 2 as each function is planned.
- Database query-level audit of every read. Entity-level read-path audit is in `00c-source-of-truth-audit.md` (separate artefact) — function-by-function line-level audit is Phase 3 per-function work.

**Method:**

1. Read the canonical config files (`page-registry.ts`, `users.ts`, `index.css`, `App.tsx`) to establish the spine.
2. Enumerate routes via `Glob` on `server/routes/*.routes.ts` + `server/*-routes.ts`.
3. Resolve permission-entity → role mapping from `shared/schema/users.ts` permission-group constants and runtime-access resolver (`client/src/config/runtime-access.ts`, `shared/schema/users.ts:314-1230` defaults).
4. Extract brand hex values from `client/src/index.css:249-254` (verified by grep — no invention).
5. Cross-check page-registry against `client/src/pages/**` for orphans (result: none found — see §5).

---

## §1.2 Lens definition (per user clarification, 2026-04-21)

A **lens** in this project is a **role-based view**. One lens per `COMPANY_ROLES` entry (16 roles). A lens is composed of:

1. A **landing page**, resolved by `ROLE_LANDING_PAGE` (`client/src/config/page-registry.ts:231-238`) for roles with `roleLandingEligibility`, or `/dashboard` → `/gates` fallback otherwise.
2. The **set of pages** the role can view, gated by:
   - `permissionEntity` on each page registry entry, resolved against `ENTITY_PERMISSION_DEFAULTS` (`shared/schema/users.ts:314-1230`) plus any runtime overrides in `role_permissions` / `user_permissions` tables.
   - App-section toggles (`sections` column on `role_permissions` — `shared/schema/users.ts:1329-1344`) — 10 sections (HOME, PROJECT_DELIVERY, PROJECT_DEVELOPMENT, ENGINEERING, QUALITY, HSE, FINANCE, PORTFOLIO, PRIORITIES, REPORTS, ADMIN).
3. The **navigation grouping** surfaced in the sidebar, driven by the 14 `NAV_GROUP_KEYS` and the `NAV_GROUP_TO_SECTION` mapping (`client/src/config/page-registry.ts:9-24, 273-288`).

The `LensProvider` React context (`client/src/hooks/use-lens-context.tsx`, mounted in `App.tsx:18,124`) already exists in code — Phase 1 work will extend it rather than replace it.

**The 16 lenses** (role → display label, from `COMPANY_ROLE_LABELS` at `shared/schema/users.ts:98-115`):

| Role key | Display label | Landing page |
|---|---|---|
| `COO_ADMIN` | COO | `/company-overview` |
| `CEO_ADMIN` | CEO | `/company-overview` |
| `CCO` | CCO | `/pd` |
| `CFO` | CFO | `/cashflow` |
| `PROGRAM_MANAGER` | Program Manager | `/execution-board` |
| `PROGRAM_FINANCE_MANAGER` | Program Finance Manager | `/cashflow` |
| `CONSTRUCTION_MANAGER` | Construction Manager | `/execution-board` |
| `QUALITY_MANAGER` | Quality Manager | `/quality` |
| `ENGINEERING_MANAGER` | Engineering Manager | `/engineering` |
| `KEY_ACCOUNTS_MANAGER` | Key Accounts Manager | `/pd` |
| `ACCOUNTANT` | Accountant | `/cashflow` |
| `ENGINEER` | Engineer | `/engineering` |
| `PROJECT_MANAGER_SITE` | Project Manager | `/execution-board` |
| `PROJECT_DEVELOPER` | Project Developer | `/pd` |
| `HSE_MANAGER` | HSE Manager | `/hse` |
| `SSEG_MANAGER` | SSEG Manager | `/hse` |

---

## §1.3 Brand assets (recorded — not modified)

Values extracted verbatim from `client/src/index.css`. Do not invent variants; Phase 1 tokens.ts must use these exact values as `--ee-brand-primary` etc.

### Logo

- **File:** `client/public/emergent-logo.png` (also at `public/emergent-logo.png` — identical bytes)
- **Dimensions:** 800 × 202 px, 8-bit PNG
- **Usages found:** `client/src/components/layout/AppLayout.tsx:251` (header, `h-7 w-auto`), `client/src/pages/login.tsx:113` (login screen)
- **Rule:** Preserved exactly. No recolouring, no cropping, no regeneration in Phase 1+.

### Primary brand colour

- **Hex:** `#16A34A` (Tailwind `emerald-600`)
- **Source:** `client/src/index.css:249` (`--cmd-brand`), `client/src/index.css:251` (`--cmd-green`)
- **HSL equivalent used for theme tokens:** `145 72% 32%` (`--primary` at `index.css:64`) and `142 76% 36%` (sidebar primary, animations — `index.css:99`). These two HSLs are not identical; the `#16A34A` hex is the canonical rendered colour.

### Brand accent

- **Hex:** `#22C55E` (Tailwind `emerald-500`)
- **Source:** `client/src/index.css:250` (`--cmd-brand-light`)

### Status colours (already in use across dashboards)

| Purpose | Hex | Source |
|---|---|---|
| Amber / warning | `#D97706` | `client/src/index.css:252` (`--cmd-amber`) |
| Red / danger | `#DC2626` | `client/src/index.css:253` (`--cmd-red`) |
| Blue / info | `#2563EB` | `client/src/index.css:254` (`--cmd-blue`) |

Semantic HSL equivalents used for theme tokens at `client/src/index.css:88-91`:

- `--success: 142 64% 36%`
- `--warning: 35 92% 45%`
- `--danger: 0 72% 51%`
- `--info: 214 78% 48%`

### Typography

- **Heading:** Barlow (`--font-heading`, `index.css:8`). Applied via `font-heading` utility + base `h1-h6` styling at `index.css:300-302`.
- **Body:** Inter (`--font-sans`, `index.css:7`). Applied at body root `index.css:268`.
- **Mono:** JetBrains Mono (`--font-mono`, `index.css:9`).

### Surfaces & shadows

- Neutral surface ladder: `--background` (white), `--surface` (`210 25% 99%`), `--surface-strong` (`210 25% 97%`), `--surface-tint` (`142 34% 97%` — brand-tinted).
- Shadows: `--shadow-xs`, `--shadow-sm`, `--shadow-md` (defined at `index.css:93-95`). These are the only approved elevation steps. Phase 1 must not add new ones without explicit sign-off.
- Radius scale: `--radius: 0.5rem` base, with `-sm` / `-md` / `-lg` derivatives (`index.css:48-50, 83`).

### Dark mode

Full parallel variable set exists at `index.css:107-158`. Phase 1 design-system tokens must expose both light and dark values — do not regress dark-mode support.

### Reduced-motion support

`@media (prefers-reduced-motion: reduce)` block already exists at `index.css:667-681, 898-910`. Phase 1 primitives must keep this honoured.

---

**End of §1.** Next checkpoint: §2 — canonical backend summary + navigation spine.

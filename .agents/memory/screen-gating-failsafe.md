---
name: Screen-availability gating is default-OPEN (finance-only mode is the lockdown)
description: How the client screen-signoff gate actually works, and why the "default-hidden until signed off" experiment was reverted.
---

# Screen-availability gating is default-OPEN

A screen is reachable UNLESS an admin has explicitly disabled it — i.e. unless
there is an `isEnabled = false` row in `app_screen_settings` (surfaced via
`/api/screen-settings` → `useScreenAvailability`). Absence of a row means
**enabled**. This matches the table contract in `shared/schema/app-settings.ts`
("Only rows where isEnabled=false need to be stored; absence means enabled"),
the column default (`is_enabled` defaults to `true`), and the admin
Functionality Control UI default (`settingsMap.get(id) ?? true`).

```
isScreenEnabled = (id) => !disabledScreenIds.has(id)   // visible unless a false-row exists
```

## The real production lockdown is finance-only mode — NOT this gate

`shared/config/enabled-modules.ts` (`isPageEnabled` / `isNavGroupEnabled`)
restricts the production deploy to the **Finance** nav-group (full) plus the
finance **SYSTEM** plumbing pages (`ENABLED_SYSTEM_PAGE_IDS`), and redirects
everything else to `/finance`. That is the owner-blessed, tested, reversible
fail-safe — to lock a module down, disable its nav-group there, not here.
The screen-availability gate is a thin, *additive* admin convenience for
turning off an individual screen; it is not the security boundary.

## Why "default-HIDDEN until signed off" was reverted (2026-06-18)

An experiment flipped this gate to default-HIDDEN ("visible only if an
`isEnabled = true` sign-off row exists, plus a 3-page bootstrap allow-list").
It bricked production: nothing ever backfills `isEnabled = true` rows (no seed,
no migration — `migrations/0016` only creates the table), and the admin UI +
schema were still default-open, so the prod table had **no** enable-rows for the
finance/settings screens. Result: all 26 finance pages + Smart Import /
QuickBooks / SharePoint intake / Integration Statuses / Audit Log / System
Settings vanished from the sidebar (`AppLayout.tsx`) and 404'd on deep-link
(`App.tsx`). Owner (COO) reverted it the same day.

**Rule:** do NOT reintroduce default-hidden screen gating. If granular
per-screen sign-off is ever wanted again, it must ship WITH (1) a data backfill
seeding `isEnabled = true` for every already-live screen, and (2) an aligned
admin-UI default — otherwise it fails closed on the very screens that are
supposed to be on.

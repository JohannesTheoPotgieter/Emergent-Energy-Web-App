---
name: Screen-availability gating is fail-safe (default-hidden)
description: How the client screen-signoff gate works and the alias-route trap that silently bypassed it.
---

# Screen-availability gating is fail-safe

A screen is reachable ONLY if it is explicitly signed off (an `isEnabled = true`
row in `app_screen_settings`, surfaced via `/api/screen-settings` →
`useScreenAvailability`) OR it is in the small bootstrap allow-list. Everything
else is hidden in nav AND returns NotFound on deep-link.

**Why:** production once showed finance screens that were never signed off,
because the gate used to be default-OPEN (visible unless an explicit
`isEnabled=false` row existed) and prod's settings table was empty. Owner (COO)
rule: "if it is not signed off it cannot be navigated to." Default-OPEN finance
gating is a trust defect — never reintroduce it.

## Gate by registry pageId, never by a path→id map
The route gate must key off `route.pageId` (the PAGE_REGISTRY id), NOT a
`path → id` map. Parametric **alias** routes (e.g. `/project/:name`) are
registered as their own component routes carrying the SAME `pageId` as the
canonical page but a DIFFERENT path. A path-keyed map only has canonical paths,
so it returns `undefined` for aliases and silently SKIPS the gate — an
un-signed-off screen stays reachable through its alias. `route.pageId` is the
same id the finance-only module gate already uses, so both gates stay consistent.

**How to apply:** any per-route gating (screen signoff, module enablement) keys
off `route.pageId`. If you add a new alias mechanism, confirm the alias route
still carries `pageId` or it will bypass every per-route gate.

## Bootstrap allow-list prevents permanent lockout
`ALWAYS_AVAILABLE_SCREEN_IDS` (settingsHome, adminRoles, adminFunctionality) stay
reachable even with an empty settings table — otherwise the default-hidden gate
would also 404 the very page where screens get signed off, bricking a fresh prod
DB. These are still RBAC-protected (`admin_roles`), so it is not an escalation.
Keep this set minimal — admin recovery surfaces only.

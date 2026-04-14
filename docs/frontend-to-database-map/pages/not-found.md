# 404 – Off the grid (`*` — fallback)

**Source file:** `client/src/pages/not-found.tsx` (42 lines)
**Route:** catch-all inside `<Switch>` in `client/src/App.tsx:397` (`<Route component={NotFound} />`)
**Permission entity:** none — rendered when no other route matches
**Role landing:** n/a

## Purpose
Static 404 screen. Shown inside the `ProtectedPages` switch when a visited
path does not resolve to any known page. Also used as the top-level fallback
route inside `Router()` (`client/src/App.tsx`).

## How the view is populated
Static render only — no `useQuery`, `useEffect`, or `fetch`. No data blocks.

## Buttons / Actions
- **"Back to Dashboard"** (`data-testid="button-go-home"`)
  - `onClick={() => navigate("/")}` (wouter `useLocation`)
  - No API call, no mutation, no DB write.
  - Side effect: client-side navigation to `/`, which is handled by `HomePage`
    in `client/src/App.tsx:387`.

## Forms / Inputs
None.

## Tabs / Sub-views / Filters / Sorts
None.

## Numbers / Counters / KPIs shown
None.

## Dialogs / Modals opened from this page
None.

## Navigation out of this page
- `/` — "Back to Dashboard" button.

## Database tables touched
**None.** This screen is purely presentational and performs no network activity.

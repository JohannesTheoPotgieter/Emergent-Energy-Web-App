# Frontend → API → Database Map

A complete map of the Emergent Energy web app that traces every user-facing
screen down through the REST API surface to the database tables that back it.
Built in response to the request: *"I want a map starting from the front end —
what each button does, how each view is populated, which APIs it uses, what
method populates it, and from what database table or object the function or
API reads."*

## Structure

```
docs/frontend-to-database-map/
├── README.md                    <- you are here
├── 01-database-tables.md        <- all 280 Drizzle pgTable definitions
├── 02-api-endpoints.md          <- all ~1,338 HTTP endpoints, grouped by file
├── 03-pages-index.md            <- master index of every page/screen
└── pages/
    ├── home.md
    ├── login.md
    ├── ms-callback.md
    ├── not-found.md
    ├── company-overview.md
    ├── dashboard.md
    ├── projects.md
    ├── project-detail.md
    ├── ... (one file per screen)
```

## How to read a page file

Each page file follows this template:

```
# <Page Label> (`<route path>`)

Source file(s)       — the .tsx file(s) behind the page
Route                — canonical URL path (from client/src/config/page-registry.ts)
Permission entity    — access gate (from page-registry.ts)

## Purpose             What the screen is for.
## How the view is     Every useQuery/useEffect/fetch/apiRequest call
  populated             → REST endpoint → server handler file → DB tables
## Buttons / Actions   Every <Button>, onClick, onSubmit, menu item, tab
                        → mutation → endpoint → handler → DB tables → side effects
## Forms / Inputs      Fields on every form with validation + target field
## Tabs / Filters      Sub-views, filters, sorts, their source
## Numbers / KPIs      Every metric card/badge with its source calculation
## Dialogs / Modals    Sub-components opened from this page
## Navigation out      Every <Link> / navigate() destination
```

## How to cross-reference

- **Find a table** → open `01-database-tables.md`, ctrl-F the SQL name.
- **Find an endpoint** → open `02-api-endpoints.md`, ctrl-F the path.
- **Find a page** → open `03-pages-index.md` for the master list.
- **Trace a data point** → open the page's file in `pages/`, follow the
  `How the view is populated` or `Buttons / Actions` section down to the
  handler file and DB tables.

## Notes on fidelity

- SQL table names are authoritative (they match what Postgres sees). JS
  identifiers (Drizzle object names) are shown alongside in the table catalog.
- Handlers listed as `NOT FOUND` are cases where no matching server handler
  exists — either the frontend is calling a stale endpoint, the endpoint
  resolves at a non-Express middleware layer, or the page file is itself
  legacy.
- Drizzle `storage.xxx()` calls go through `server/storage.ts` and
  `server/repositories/*`. Where a handler calls `storage.foo()`, the tables
  are traced by opening the storage method.

## Scope

- **112 active page components** (from `client/src/pages/`)
- **~1,338 Express endpoints** across 105 route files in `server/`
- **280 Postgres tables** defined across `shared/schema/*.ts`

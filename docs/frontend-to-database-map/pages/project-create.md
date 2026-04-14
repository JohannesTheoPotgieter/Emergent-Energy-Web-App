# Project Create (`/project-create`)

> **Draft (agent-generated):** this file was produced by an automated exploration agent and has NOT yet been verified against server handlers or schema. Table names and API paths may be approximate. A follow-up pass will trace each endpoint to its handler (file + line) and reconcile table names with `shared/schema/`.
**Source file(s):** `client/src/pages/project-create.tsx`

**Route:** `/project-create`

**Permission entity:** project_creation

**Role landing:** None (permission-gated page)

## Purpose
Allows authorized users to create new projects with client linkage, project codes, locations, and initial phases. Automatically applies phase templates and engineering stages based on configuration.

## How the view is populated

- **Template Constants**:
  - API: `GET /api/template-constants`
  - Reads tables: `template_constants` (or similar)
  - Populates: `projectPhases`, `projectPhaseLabels` for phase dropdown

- **Clients List**:
  - Hook: `useQuery` with queryKey `["/api/clients", "project-create"]`
  - API: `GET /api/clients`
  - Reads tables: `clients`
  - Populates: Client dropdown in form

- **Similar Projects Check**:
  - Hook: `useQuery` with queryKey `["/api/projects/similar-names", debouncedName]`
  - API: `GET /api/projects/similar-names?name={name}`
  - Triggered when projectName >= 3 chars
  - Populates: Duplicate warning alert

## Buttons / Actions (exhaustive)

- **Create Project** (submit button) — creates new project
  - Mutation: Direct `fetch POST /api/projects`
  - API: `POST /api/projects`
  - Handler file: `server/projects-routes.ts`
  - Writes tables: `project_info`, `project_plan`, `engineering_stages`, `audit_events`
  - Side effects: Success card displays result, applies phase template if configured, generates engineering stages
  - Navigates: Stays on success screen

- **Create Another** (button on success) — resets form
  - Action: `resetForm()` clears all fields
  - Navigation: None, resets UI to blank form

- **View Lifecycle Board** (button on success) — navigate to lifecycle board
  - Action: `setLocation("/lifecycle-board")`
  - Navigation: To `/lifecycle-board`

- **I've checked — proceed anyway** (button in warning) — dismisses duplicate warning
  - Action: `setDuplicateWarningDismissed(true)`
  - Side effects: Hides warning alert

- **Create or manage clients** (link button) — navigate to client management
  - Action: `setLocation("/project-lifecycle/client-overview")`
  - Navigation: To `/project-lifecycle/client-overview`

## Forms / Inputs

- **Project Name** (required, text input)
  - Label: "Project Name *"
  - Field: `form.projectName`
  - Validation: Must be non-empty
  - Triggers: Similar projects check (>= 3 chars)
  - Mutation body: `projectName`

- **Client** (optional, searchable select)
  - Label: "Client"
  - Field: `form.clientId`
  - Options: Populated from `/api/clients`
  - Display format: `"{name} ({clientId})"`
  - Mutation body: `clientId`, `clientName`

- **Project Code** (optional, text input)
  - Label: "Project Code"
  - Field: `form.projectCode`
  - Placeholder: "e.g. PRJ-042"
  - Mutation body: `projectCode`

- **Location** (optional, text input)
  - Label: "Location"
  - Field: `form.location`
  - Placeholder: "e.g. Gauteng"
  - Mutation body: `location`

- **Initial Phase** (dropdown select)
  - Label: "Initial Phase"
  - Field: `form.initialPhase`
  - Default: "P0_FIRST_ASSESSMENT"
  - Options: From `constants?.projectPhases` with labels
  - Mutation body: `initialPhase`

## Success Result Display

When project created successfully, displays:
- Project name
- Phase label (human-readable phase name)
- Client name (if linked)
- Template application result: `tasksCreated`, `deliverablesCreated`
- Engineering stages result: `stagesCreated`, `tasksCreated`, stage details list

## Navigation out of this page

- **View Lifecycle Board** — to `/lifecycle-board` (after success)
- **Create or manage clients** — to `/project-lifecycle/client-overview` (from form hint link)


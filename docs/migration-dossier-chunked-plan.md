# Migration Dossier Delivery Plan (Chunked to Avoid Timeout)

This plan breaks the original migration-architecture request into smaller, sequential sections so progress can be reviewed after each step.

## Delivery protocol

- We will deliver **one section at a time**.
- Each section ends with:
  1. `What I inspected`
  2. `Findings`
  3. `Risks spotted now`
  4. `Open questions before next section`
  5. `Ready for next section: Yes/No`
- No implementation or schema changes are made during these sections.
- Every finding should reference concrete repository artifacts (tables, routes, files, components).

## Section breakdown

### Section 1 — Repo inventory and architecture surface map

**Goal:** Build a complete index of where schema, models, routes, services, importers, auth, UI navigation, and state logic currently live.

**Covers:**
- DB schema + migrations + SQL definitions
- ORM models
- Backend modules + API routes + service layer
- Import/batch paths
- Auth, users, roles
- Frontend navigation and top-level pages
- State/data-fetch entry points

**Output:**
- File-by-file discovery matrix
- Dependency hotspots
- Unknown areas requiring deeper trace

---

### Section 2 — Current data model deep map

**Goal:** Build table/model-level map of current entities, keys, and relationship chains.

**Covers:**
- Projects, stages/phases, tasks/work, approvals/gates, evidence/resources, finance, users/roles
- Duplicate or overlapping entities
- Cascades, FK constraints, inferred referential behavior

**Output:**
- Current canonical entities list
- Duplicate-concept matrix
- Critical relational paths that must not break

---

### Section 3 — API, route, and workflow behavior map

**Goal:** Identify how current runtime behavior depends on existing entities and field names.

**Covers:**
- API endpoints → services → data access
- Frontend routes/views → API contracts
- Legacy route contracts (`project_info.projectName` etc.)
- Workstream filters and role-aware behavior

**Output:**
- Route/API compatibility map
- Workflow runtime map
- Early regression risks if moved too soon

---

### Section 4 — Current-to-target entity mapping

**Goal:** Produce explicit current→target mapping classification for all relevant entities.

**Covers:**
- Current table/model → target table/model
- Current field → target field
- Mapping classification per item:
  - direct fit
  - transform needed
  - split needed
  - merge needed
  - compatibility layer
  - outside core spine
  - unknown/decision needed

**Output:**
- Master mapping matrix
- Per-entity cutover notes

---

### Section 5 — Live functionality preservation checklist

**Goal:** Enumerate critical flows and state exactly what could break if migration order is wrong.

**Covers:**
- Auth/login
- Role-aware views
- Project CRUD and detail pages
- Work/task flows
- Gates/approvals/evidence
- Finance flows
- Imports
- Reporting
- Navigation, routing, and Gantt/planning

**Output:**
- Must-survive function checklist
- Breakage-by-sequence warnings

---

### Section 6 — Risk register and rollback design

**Goal:** Build explicit risk register with mitigations and rollback path.

**Covers:**
- Data loss/orphans/FK integrity
- Auth regressions
- Route/API regressions
- Importer breakage
- Dual-source-of-truth drift
- Audit history integrity
- Approval and finance integrity

**Output:**
- Risk table: risk, failure mode, severity, mitigation, rollback
- Gate conditions for pausing rollout

---

### Section 7 — Staged migration plan (Phase 0 to Phase 8)

**Goal:** Produce safe, phased plan with go/no-go criteria and non-change guarantees per phase.

**Covers:**
- Phase 0 through Phase 8 exactly as requested
- For each phase:
  - purpose
  - scope
  - dependencies
  - what changes
  - what does not change
  - validation
  - rollback
  - go/no-go gate

**Output:**
- Executable migration blueprint

---

### Section 8 — Migration order, test strategy, and Prompt 2 handoff

**Goal:** Finalize safest sequence and must-pass test packs; generate exact next implementation prompt.

**Covers:**
- Recommended migration order (identities → parties → projects → …)
- Pre-migration and per-phase tests
- Final A–J dossier assembly
- Exact Prompt 2 text

**Output:**
- Complete final dossier in required A–J format
- Production-safe Prompt 2 implementation brief

## Feedback template used after each section

```text
Section N Feedback
- Completed scope:
- Artifacts inspected:
- Key findings:
- Risks identified now:
- Blockers/ambiguities:
- Recommendation before proceeding:
- Ready for next section: Yes/No
```


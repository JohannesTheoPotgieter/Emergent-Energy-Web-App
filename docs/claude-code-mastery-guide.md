# Claude Code Mastery Guide — Emergent Energy Web App

**Status:** Living document. Last verified 2026-04-15.
**Audience:** Anyone using Claude Code against this repo.
**Scope:** This guide is specific to *this codebase*. Generic Claude Code tips
are not repeated here — see
[Anthropic's best-practices post](https://www.anthropic.com/engineering/claude-code-best-practices)
for those.

## What this guide is (and isn't)

The goal of this document is to make Claude Code productive on a repository
with these specific characteristics:

- TypeScript monorepo: React 19 + Vite + Express 5 + Drizzle ORM + PostgreSQL
- 60+ large server route files (several > 100 KB each)
- 26 domain-scoped schema files under `shared/schema/`
- 207+ SQL migrations under `/migrations/`
- Dual-mode DB (PostgreSQL prod, `better-sqlite3` dev fallback)
- 16 RBAC roles, enforced server-side
- In-progress migration from `server/*-routes.ts` (legacy) to
  `server/routes/*.routes.ts` (current)
- Microsoft 365 (Graph, SharePoint, Outlook, Teams) integration
- An Excel-driven "Smart Import v2" pipeline that writes temporal snapshots

The guide encodes *operational* rules for Claude Code: the files it should
read, the rules it must not violate, the commands it should run, and the
invariants it should check before committing.

## What changed from the original draft

This guide was rewritten after an audit of the original Claude Code Mastery
Guide draft against the actual codebase. Several load-bearing claims in the
original were wrong and would have actively misled Claude. The corrections:

| Area | Original (wrong) | Corrected |
|---|---|---|
| Migrations location | `server/migrations/` | `/migrations/` at repo root |
| Schema source of truth | `shared/schema.ts` | `shared/schema/*.ts` (26 files); `schema.ts` is a barrel |
| Routing library | React Router | `wouter` |
| `requireRole` import | `server/permission-middleware.ts` | `server/middleware/requireRole.ts` |
| Route file pattern | `server/<domain>-routes.ts` | **New code:** `server/routes/<domain>.routes.ts` |
| Snapshot tables | `normalized_cost_lines`, `program_expense` | `normalizedCostLines`, `normalizedRevenueLines`, `cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`, `categoryRevenueAllocations`, `projectRevenueSummary` (PE/PI are deprecated types) |
| RBAC role count | 7 | 16 (see `shared/schema/users.ts` `COMPANY_ROLES`) |
| Excel import primary | `server/excelParser.ts` | `server/smart-import-routes.ts` + `server/imports/` (v2); `excelParser.ts` is legacy |
| Hook env var | `CLAUDE_FILE_PATHS` | Reads stdin JSON (proper hook protocol) |

Every rule in this guide was verified against the actual repo before being
written down. When a rule drifts, follow the "Keeping CLAUDE.md fresh"
procedure at the bottom of this doc.

## The operational files

This guide is supported by a set of files in the repo that Claude reads
automatically:

```
CLAUDE.md                              session-start context (read every session)
.claude/settings.json                  hook configuration
.claude/hooks/pre-commit-check.sh      runs check:client before git commit
.claude/skills/
  ├── finance-snapshot-queries/        effective_to IS NULL rule
  ├── route-conventions/               server/routes/*.routes.ts pattern
  ├── ms-graph-integration/            metadata-only, COO-only sync
  └── smart-import-v2/                 hash IDs, overrides, snapshots
.claude/commands/
  ├── ee-review.md                     invariant review checklist
  ├── ee-new-route.md                  scaffold a new domain router
  ├── ee-db-change.md                  additive schema change workflow
  ├── ee-fix-ts.md                     drive npm run check to zero
  └── ee-pr.md                         commit gate (does NOT push)
.claude/agents/
  ├── ee-security-reviewer.md          independent security review
  └── ee-snapshot-auditor.md           grep for missing effectiveTo guards
```

Everything else in this guide explains *why* those files exist and *how* to
use them.

## The core workflow: Explore → Plan → Implement → Verify

This repo is too large for Claude to "explore freely" without filling its
context window before writing any code. The non-negotiable workflow:

### 1. Explore (in Plan Mode — `Shift+Tab`)

Tell Claude exactly which files to read. Name them. Forbid the rest.

> Read `server/routes/financials.routes.ts`, `server/repositories/finance-temporal-repository.ts`,
> and the `normalizedCostLines` table definition in `shared/schema/finance.ts`.
> Do NOT read any other server files. I want you to understand how the
> current cost-line read path works.

Claude Code's Plan Mode prevents it from making edits, so this phase is safe
for read-only discovery.

### 2. Plan (still in Plan Mode — use `ultrathink`)

> I want to add a monthly cost variance endpoint at
> `GET /financials/projects/:id/cost-variance`. It should compare actual
> vs budget per month. `ultrathink` — what needs to change across the
> repository, snapshot-tables, and tests? Produce a step-by-step plan.

Open the plan in your editor (`Ctrl+G`) and edit it before accepting.
This is where you catch *"you forgot to update the Playwright smoke test
for the new role"* **before** it costs you an hour.

### 3. Implement (Normal Mode)

> Implement the plan from `docs/active/cost-variance/plan.md`.
> After each file change, run `npm run check:client` for client files or
> `npm run check` for server/shared files. Fix errors at the source — no
> `as any`, no `@ts-ignore`.

### 4. Verify

> Run the targeted API test I added: `npx vitest run qa/tests/api/cost-variance.test.ts`.
> Then invoke the `ee-snapshot-auditor` subagent on the files you touched.
> Only after both pass should we go near `/ee-pr`.

## Context management

The single most common failure mode on this repo is context saturation — Claude
reads `storage.ts` (85 KB), `smart-import-routes.ts` (163 KB), and
`engineering-routes.ts` (145 KB) in sequence and has no room left to think.

### When to `/clear`

- After completing a feature end-to-end, before starting the next.
- When switching domains (finance → engineering → imports).
- The moment Claude starts contradicting a rule from `CLAUDE.md` — it's
  forgetting context.
- After any debugging session that involved reading one of the big route
  files.

### The dev-docs pattern

For any non-trivial feature, create a working folder before you start:

```
docs/active/<feature-name>/
├── plan.md         the approved plan (edited after Plan Mode)
├── context.md      specific files + schema fields + invariants in scope
└── tasks.md        numbered checklist, ticked as you go
```

Before you `/clear`, have Claude append progress notes to `tasks.md`. When
you resume in a new session:

> Read `docs/active/cost-variance/plan.md` and `tasks.md`. Pick up from the
> next unchecked item. Do NOT re-explore the codebase — trust the plan.

`docs/active/` does not yet exist in the repo — create it the first time you
need it. Gitignore individual feature folders if you don't want them on
`main`.

### Reading discipline

Three heuristics that keep Claude under context budget:

1. **Name files, never directories.** "Read `server/routes/imports.routes.ts`",
   never "Read `server/routes/`".
2. **Use Grep first, Read second.** If you're looking for a specific query,
   grep for the table name — then read only the matching file.
3. **Prefer the repository over the route file.** Most route files are thin
   wrappers. The real logic lives in `server/repositories/*`. Read the repo
   file first.

## Skills reference

Skills are modular, lazily-loaded rule files under `.claude/skills/`. Claude
only loads a skill when the task description matches its frontmatter. This
keeps your base context lean.

### `finance-snapshot-queries`

**Triggers on:** any work touching `normalizedCostLines`, `normalizedRevenueLines`,
`cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`,
`categoryRevenueAllocations`, `projectRevenueSummary`.

**Rule:** every read query must include `isNull(table.effectiveTo)` (Drizzle)
or `effective_to IS NULL` (raw SQL). Omitting the guard double-counts
historical snapshot rows.

Deprecated: `ProgramExpense` / `ProgramInflows` type aliases in
`shared/schema/finance.ts` — use the `normalized*` tables for new code.

### `route-conventions`

**Triggers on:** creating, editing, or reviewing Express route files.

**Rules:**

- New routes → `server/routes/<domain>.routes.ts` (dot-separator, current
  pattern). Legacy `server/<domain>-routes.ts` files are edit-only.
- `requireAuth` from `server/middleware/requireAuth.ts`.
- `requireRole` from `server/middleware/requireRole.ts` (**not**
  `permission-middleware.ts`).
- Zod validation via `validateBody`.
- `ApiError` from `server/lib/api-error.ts` — never leak raw DB errors.
- All CRUD through `server/repositories/*` — no `db.select()` in handlers.
- Reference `COMPANY_ROLES` from `shared/schema/users.ts` — never hardcode
  role strings.

### `ms-graph-integration`

**Triggers on:** Outlook / SharePoint / Teams / MSAL / delta-sync work.

**Rules:**

- Metadata + deep links only. Never store email bodies or attachment bytes.
- SharePoint Engineering intake sync is COO-only, manual Pull/Push. Gate with
  `requireRole(["COO_ADMIN"])`.
- Use the mock connector when Graph tokens are unavailable — don't hard-fail
  the server.
- Tokens encrypted via `server/lib/token-encryption.ts`; prod secrets via
  Azure Key Vault.
- Validate every Graph response field with Zod — Microsoft changes shapes
  silently.

### `smart-import-v2`

**Triggers on:** Excel import, project upserts, snapshot writes, override
scenarios.

**Rules:**

- Current pipeline: `server/smart-import-routes.ts` + `server/imports/`.
  Legacy: `server/excelParser.ts`, `server/importPipeline.ts` (read-only).
- Projects upsert by `projectCode` — never wipe other projects.
- Hash-based line IDs (`expense_line_id`, `inflow_line_id`) must be stable
  across re-imports. Changing the hash inputs orphans every existing override.
- Imports write temporal snapshots: close the previous row
  (`effective_to = now()`), insert the new row (`effective_to = NULL`).
- Overrides stored separately with an audit trail — never overwrite baseline.
- Conflict policy lives in `server/imports/import-conflict-policy.ts`.

## Slash commands reference

Slash commands are shortcuts stored under `.claude/commands/*.md`. Invoke
them as `/ee-review`, `/ee-new-route`, etc. They accept free-form arguments
which are substituted into `$ARGUMENTS` inside the template.

### `/ee-review`

Static review of the current session's changes against a 10-point EE
invariant checklist (snapshot guards, RBAC, repository layer, migrations
location, SQLite-compatible SQL, error handling, type safety, legacy-file
encroachment). Outputs a numbered checklist with file + line references.

Use this before `/ee-pr` — it's faster than running the test suite and
catches the most common classes of EE-specific bugs.

### `/ee-new-route <description>`

Scaffolds a new route domain following the current
`server/routes/<domain>.routes.ts` pattern. Constrains the file read set
(no exploring the legacy flat-file routes), produces a plan, waits for
approval, then implements. Wires the new router into `server/routes/index.ts`
and `server/routes.ts`.

Example:

> /ee-new-route monthly cost variance endpoints for the Financials domain

### `/ee-db-change <description>`

Plans and applies a schema change + matching migration. Enforces:

- Edit only the relevant `shared/schema/<domain>.ts` file (never
  `shared/schema.ts` — it's a barrel).
- Migration lives under `/migrations/` at the repo root (never
  `server/migrations/`).
- Additive-only, `IF NOT EXISTS` / `IF EXISTS` guarded statements.
- SQLite-compatible SQL unless explicitly guarded Postgres-only.

Does NOT run `db:push` — you apply the migration manually after review.

### `/ee-fix-ts`

Drives `npm run check` to zero errors by fixing **root causes**. Banned:
`as any`, `@ts-ignore`/`@ts-expect-error` without explanation,
`unknown`-to-target casts, duplicate-of-schema interfaces. Reports grouped
fix categories and flags anything it chooses not to fix for your decision.

### `/ee-pr`

The commit gate. Runs `npm run check` + `npm run test` (unit only — API
and smoke tests are too slow for the per-commit gate), stages the session's
changes by name (never `-A` / `.`), writes a commit following the repo's
`<type>(<domain>): <description>` convention, and **stops before pushing**.
Reports the commit SHA back for your review.

Push is intentionally manual. You decide when and where.

## Subagents

Subagents run in an isolated context window. That matters here because your
largest route files are ~100–160 KB each — reading even two of them consumes
a meaningful slice of your main conversation's context. Delegate heavy
read-scans to a subagent and take back only its written findings.

### `ee-security-reviewer`

An independent second pair of eyes for a finished feature branch. Does not
see your conversation — so it cannot be influenced by your intent. Checks
RBAC, input validation, SQL injection risk, error-leak patterns, secret
exposure, email-body leakage, session / CSRF hygiene, and bank-detail
encryption. Returns a severity-tagged findings list (HIGH / MED / LOW).

Invoke when:

- A feature is code-complete and about to go into review.
- A reviewer flagged "I'm worried about permissions" — get a clean second
  opinion.
- You're about to merge a PR that touches a sensitive domain (finance,
  bank details, SharePoint sync, user management).

### `ee-snapshot-auditor`

Greps the repo for reads against the temporal snapshot tables and flags
every query missing the `effectiveTo IS NULL` guard. Read-only. Returns a
file + line list.

Invoke after any change that touches finance, reporting, or dashboard code
— and as a periodic full-repo sweep. It's fast and cheap.

### Why not more subagents?

Because a subagent that doesn't have a clear, narrow scope just duplicates
what Claude would do anyway. Two focused subagents beat ten vague ones.
Add a new subagent only when you've seen the same audit pattern repeat
three or more times.

## Hooks

Hooks in `.claude/settings.json` execute shell commands in response to
tool events. Getting them right on this repo takes care — the wrong hook
will either break Claude's flow or silently do nothing.

### What this repo ships

One minimal hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": ".claude/hooks/pre-commit-check.sh" }
        ]
      }
    ]
  }
}
```

The script `.claude/hooks/pre-commit-check.sh`:

1. Reads tool input JSON **from stdin** (the correct hook protocol — not
   from a `CLAUDE_FILE_PATHS` env var, which does not exist).
2. Extracts the bash command string via `jq` (with a grep fallback if `jq`
   is not installed).
3. Returns early unless the command is a `git commit`.
4. Runs `npm run check:client` — the fastest available TypeScript check.
5. Blocks the commit (exit 2) on failure, with a clear error message and a
   `CLAUDE_SKIP_PRECOMMIT=1` escape hatch for documented-emergency bypass.

### Why only `check:client`?

Full `npm run check` typechecks both configs and takes long enough that a
developer will disable the hook rather than wait for it on every commit.
`check:client` covers the client-side scoped config, which is where most
per-edit regressions show up. For full server-side coverage, run
`/ee-pr` — it runs `npm run check` as part of the commit gate.

### Optional: PostToolUse auto-check

Not shipped by default. If you want TypeScript checking after every file
write, add this to `.claude/settings.json`:

```json
"PostToolUse": [
  {
    "matcher": "Write|Edit",
    "hooks": [
      { "type": "command", "command": ".claude/hooks/ts-check-on-edit.sh" }
    ]
  }
]
```

…and create `ts-check-on-edit.sh` that reads the stdin JSON, extracts
`.tool_input.file_path`, and runs `check:client` if the file is under
`client/`, or `check` if it's under `server/` or `shared/`. This is noisy
on fast iteration; most developers prefer to run checks in batches.

### What not to do

- Do NOT use `CLAUDE_FILE_PATHS` or `CLAUDE_TOOL_INPUT` env vars in hooks.
  They are not part of the hook protocol. Read stdin JSON.
- Do NOT block `git commit` on `npm run test` or any other multi-minute
  command. The hook will get disabled and you'll lose the gate entirely.
- Do NOT skip hooks with `--no-verify` casually. That defeats the purpose
  and hides regressions. Use the `CLAUDE_SKIP_PRECOMMIT=1` escape hatch
  (which is visible in the hook's log output) if you need a one-off bypass.

## The biggest gotchas in this codebase

These are the places where Claude is most likely to produce a plausible but
wrong change without explicit instruction. The mitigation column points at
the file or rule that catches it.

| Risk | Where | What Claude gets wrong | Mitigation |
|---|---|---|---|
| Missing `effectiveTo IS NULL` | `normalizedCostLines`, `normalizedRevenueLines`, `cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`, `categoryRevenueAllocations`, `projectRevenueSummary` | Omits guard → double-counts historical snapshots | `CLAUDE.md` Database Rules; `finance-snapshot-queries` skill; `ee-snapshot-auditor` subagent |
| Wrong migrations location | `server/migrations/` vs `/migrations/` | Puts new migrations in `server/migrations/` where Drizzle will not find them | `CLAUDE.md` Do NOT list; `/ee-db-change` command |
| Schema barrel edit | `shared/schema.ts` | Adds tables to the 33-line barrel instead of the domain file | `CLAUDE.md` Schema Rules; `/ee-db-change` command |
| Wrong routing library | Client imports | Writes `react-router-dom` imports — we use `wouter` | `CLAUDE.md` Frontend Rules |
| Wrong `requireRole` path | Route imports | Imports from `server/permission-middleware.ts` (wrong) | `CLAUDE.md` Auth Rules; `route-conventions` skill |
| Legacy route pattern | `server/<domain>-routes.ts` | Creates new files under the deprecated hyphen pattern | `CLAUDE.md` API Style; `/ee-new-route` command |
| Hardcoded role list | Route handlers | Hardcodes "COO" / "CFO" / "PM" — misses 10+ real roles | `CLAUDE.md` Auth Rules → read `COMPANY_ROLES` from `shared/schema/users.ts:77` |
| `::` cast syntax | Raw SQL | Breaks the dev SQLite fallback | `CLAUDE.md` Database Rules; `/ee-review` command |
| Repository bypass | Route handlers | Calls `db.select()` directly instead of going through `server/repositories/` | `CLAUDE.md` Database Rules; `route-conventions` skill |
| Work items adapter | `server/work-items-adapter.ts`, `server/work-items-backfill.ts` | Extends retired writable-view code | `CLAUDE.md` Do NOT list — legacy read-only |
| Excel legacy parser | `server/excelParser.ts`, `importPipeline.ts` | Extends legacy parser instead of Smart Import v2 | `smart-import-v2` skill; `CLAUDE.md` Smart Import Rules |
| Full email / attachment in DB | Outlook / Graph integration | Stores bodies or attachment bytes instead of metadata + deep links | `ms-graph-integration` skill; `ee-security-reviewer` subagent |
| Destructive migration | `/migrations/*.sql` | `ALTER TABLE … DROP COLUMN` or `RENAME` | `CLAUDE.md` Migrations Policy; `/ee-db-change` command |
| Type duplication | Route handlers | Declares `interface Project { … }` duplicating `typeof projects.$inferSelect` | `CLAUDE.md` Schema Rules; `/ee-fix-ts` command |
| Bank details unencrypted | Payment / finance flows | Writes plain-text bank fields to DB | `ee-security-reviewer` subagent; `server/lib/field-encryption.ts` |

## Session templates

Copy these directly into Claude Code for the common task shapes. The point
is to constrain scope *before* Claude starts exploring.

### Adding a feature to an existing domain

```
CONTEXT CONSTRAINT. Only read:
- server/routes/<domain>.routes.ts  (or the legacy flat file if it hasn't
  migrated yet)
- server/repositories/<relevant>.ts
- shared/schema/<domain>.ts  (only the table in scope)

Do NOT read any other server/ or shared/ files.

TASK: <describe the feature>

Plan first. Don't write code until you've described:
1. Files changed and why
2. Schema changes (if any)
3. Migration file path under /migrations/ (if any)
4. Which COMPANY_ROLES values gate the new endpoint
5. Which tests you will add under qa/tests/

After I approve the plan, implement. After implementing:
- Run `npm run check`
- Run the specific test file you added (not the full suite)
```

### Debugging a finance calculation bug

```
Symptom: <e.g. "cashflow total is double the actual value for project 42">

Suspected area: <e.g. "aggregate read in finance-temporal-repository.ts">

CRITICAL CHECK: grep for every query against normalizedCostLines,
normalizedRevenueLines, cashflowPoints, financeRevenueMonthly,
financeCosMonthly, categoryRevenueAllocations, projectRevenueSummary in
the suspected area and verify each one includes isNull(table.effectiveTo).

Do NOT read full files. Grep for the table name first, then read only the
matching lines.

After you report findings, invoke the ee-snapshot-auditor subagent against
the server/repositories/finance-*.ts files for a second pass.
```

### Adding a new RBAC role

```
New role: <ROLE_CODE>
Intended permissions: <list>

Files to read (ONLY these):
- shared/schema/users.ts (COMPANY_ROLES constant + role_definitions table)
- server/middleware/requireRole.ts
- server/middleware/requireAuth.ts
- One or two existing routes that use a similar role for reference

Plan first:
1. Where is COMPANY_ROLES defined and what updates?
2. Does role_definitions need a seed row? Where does that get seeded?
3. Which existing routes need the new role added to their requireRole list?
4. Which Playwright smoke spec(s) under qa/tests/e2e/ need a new role actor?
5. Any CLAUDE.md / docs/claude-code-mastery-guide.md updates to the role
   list reference?
```

### MS Graph / SharePoint feature

```
Task: <describe change>

Files to read (ONLY these):
- server/sharepoint-list.ts
- server/intake-connector.ts
- server/engineering-intake-routes.ts (or server/routes/<if migrated>)
- server/ms-sync-service.ts (only if touching delta sync)

Hard constraints:
- Mock connector must still work for dev (check the existing pattern)
- Metadata + deep links only — never store email bodies or attachments
- SharePoint sync remains COO-only, manual Pull/Push
- Don't touch MSAL / token encryption files

Plan first. Don't edit authentication or token-cache code without explicit
approval.
```

### Schema change (the safe path)

```
Schema change: <describe>

Use /ee-db-change to plan. The plan must:
1. Edit only shared/schema/<domain>.ts (not shared/schema.ts)
2. Produce a migration at /migrations/<YYYYMMDD>_<name>.sql
3. Every statement guarded with IF NOT EXISTS / IF EXISTS
4. Additive only — no DROP, no non-nullable-without-default
5. SQLite-compatible (no :: casts)
6. List the repositories / queries that will read the new column

After approval: implement, run `npm run check`, STOP. I apply the migration.
```

## Keeping CLAUDE.md fresh

`CLAUDE.md` encodes facts that drift over time. Stale rules are worse than
no rules — Claude will trust them confidently and make plausible wrong
changes. Re-verify on this cadence:

**Triggers that require a refresh:**

- A `COMPANY_ROLES` change in `shared/schema/users.ts` → update the role
  list reference in `CLAUDE.md` and in this guide's gotchas table.
- A new temporal snapshot table added (any table with an `effective_to`
  column) → update the snapshot-tables list in `CLAUDE.md`, the
  `finance-snapshot-queries` skill, and the `ee-snapshot-auditor` subagent.
- A route-pattern migration milestone (more legacy files converted to
  `server/routes/*.routes.ts`) → update the API Style section and the
  gotchas table.
- A retired legacy file (e.g. the next work-items-adapter-equivalent) →
  add to `CLAUDE.md`'s Do NOT list.
- A Smart Import pipeline move or v3 rollout → update the
  `smart-import-v2` skill and the Smart Import Rules section.

**The refresh procedure:**

Run these checks and confirm each rule in `CLAUDE.md` still matches reality.
None of these should take more than a minute each.

```bash
# 1. Confirm the role list
grep -A 30 "COMPANY_ROLES" shared/schema/users.ts | head -40

# 2. Find every table with an effective_to column
grep -rln "effective_to" shared/schema/

# 3. Confirm migrations location and count
ls migrations/*.sql | wc -l
ls server/migrations/  # should be TS maintenance scripts only, not SQL

# 4. Verify the routing library
grep '"wouter"\|"react-router' package.json

# 5. Verify the requireRole location
find server -name "requireRole.ts"

# 6. Count legacy vs new route files (watch the migration progress)
ls server/*-routes.ts 2>/dev/null | wc -l
ls server/routes/*.routes.ts 2>/dev/null | wc -l

# 7. Confirm schema.ts is still just a barrel
wc -l shared/schema.ts shared/schema/*.ts
```

For each discrepancy found, update **both**:

1. The relevant section of `CLAUDE.md`
2. The corresponding section of this guide (`docs/claude-code-mastery-guide.md`)

…then bump the `Last verified` date at the top of each file and commit:

```
docs(claude): refresh CLAUDE.md rules — 2026-MM-DD verification
```

**If you can't re-verify, remove the rule** rather than leaving a stale
one in place. A missing rule makes Claude ask; a wrong rule makes Claude
confidently break things.

## Credit

This guide was produced after an audit of an original Claude Code Mastery
Guide draft against the real repo. The corrections in § "What changed from
the original draft" came from verifying every load-bearing claim with Grep
and Read against the actual `shared/schema/*.ts`, `server/`, `migrations/`,
and `package.json`. Future contributors: please do the same before adding
rules. A verified rule is an asset; an unverified rule is a liability.


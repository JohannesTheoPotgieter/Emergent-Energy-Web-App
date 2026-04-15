---
description: Full quality gate (check + test) then stage + commit. Does NOT push.
---

Prepare a commit for the current session's changes.

## Step 1 — Quality gate

Run in order, stop and report if any step fails:

1. `npm run check` — full TypeScript check (server + client). Fix any errors
   at the source (see `/ee-fix-ts` rules — no `as any`, no `@ts-ignore`).
2. `npm run test` — unit tests. If a failure looks unrelated to your changes,
   tell me before proceeding; don't silently skip.

Do NOT run `npm run test:api`, `npm run test:smoke`, or `npm run qa:full-proof`
here — those are too slow for the commit gate. Mention them in the commit body
only if I've run them manually and passed the results.

## Step 2 — Stage

- Review `git status` and `git diff`.
- Stage only the files that belong to this change. Add them by name —
  do not use `git add -A` or `git add .`.
- If `replit.md`, `docs/architecture.md`, or `CLAUDE.md` need updating because
  the change affects documented architecture or invariants, update them now
  and stage those updates too.

## Step 3 — Commit

- Follow the repo's commit style (look at `git log --oneline -10` for recent
  examples).
- Format: `<type>(<domain>): <short description>`
  - Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
  - Example: `feat(finance): add monthly cost variance endpoint`
- Keep the subject line under 72 characters.
- Use a commit body only when the "why" isn't obvious from the subject line.

## Step 4 — STOP

**Do NOT push.** Report the commit SHA and summary back to me. I'll decide
when and where to push.

# codex_finance_end_to_end_audit_prompt.md — SUPERSEDED

> **This standalone prompt is SUPERSEDED. Do not act on it as an independent source of finance rules.**

The single, canonical source of finance rules is **`docs/finance-source-of-truth-audit.md` Part I**,
enforced by **`docs/AGENT_GUARDRAILS.md` § 3 and § 3B (SETTLED)**. Codex-specific finance instructions
live in **`AGENTS.md` → "Finance — READ THIS FIRST"**.

If you came here for an end-to-end finance audit prompt, follow these instead:

- **Read first:** `docs/finance-source-of-truth-audit.md` Part I, then `docs/AGENT_GUARDRAILS.md` § 3 / § 3B.
- **Never propose finance formula / number / calculation changes** — the settled rules are final
  (revenue = category-scoped per-line POC `(Q ÷ X_category) × J_category`, recognised on invoice-raised
  date col T; receipt date col W = cashflow only; no-PO flag retired; single read path
  `server/repositories/finance-line-level-repository.ts`).
- **Audit-validity rule (§ 3B S7):** only audits run against **Postgres / production** with the current
  guardrails count toward finance sign-off. Local-SQLite runs report **environment health only — never
  finance trust**.
- **Run finance audits READ-ONLY against Postgres / production** — no writes, no mutations on prod.
- Finance code is **FROZEN** (§ 3B S10) — changes need explicit owner approval.

There is no separate rules surface here. The canonical doc wins.

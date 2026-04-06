# Routing Canonical Model

## Canonical source of truth

- `client/src/config/page-registry.ts` is the canonical client route inventory.
- `client/src/config/route-components.tsx` is the canonical routeComponentKey → lazy component registry.
- `client/src/App.tsx` is a renderer layer only.
- `client/src/config/app-route-plan.ts` is the route-plan compiler used by `App.tsx` and parity tests.

## Contracts

1. Every route with `routeComponentKey` must resolve to a key in `ROUTE_COMPONENTS` from `client/src/config/route-components.tsx`.
2. Redirect sources must be unique across `LEGACY_REDIRECTS` and registry alias entries.
3. Any new route/alias must be added in `PAGE_REGISTRY`; do not hand-wire route truth in `App.tsx`.

## Guardrails

- Test: `qa/tests/unit/route-registry-parity.test.ts`
- Redirect chain check: `scripts/check-redirect-chains.ts`
- Route migration check: `scripts/check-routes-migration.ts`

## Legacy retention policy

Legacy redirects are retained only when needed for backward-compatible bookmarks. If retaining one, document the owner and removal trigger in `docs/qa/route-truth-baseline-2026-04-06.md` or a follow-up cleanup record.

# Engineering / Quality / Commissioning Route Smoke Matrix

Purpose: runtime smoke proof that critical frontend routes are backed by mounted API surfaces with expected permission middleware, while preserving intentional legacy aliases.

## Active route matrix

| Domain | Frontend path | Backend endpoint | Method | Required permission | Notes |
|---|---|---|---|---|---|
| Engineering | `/engineering` | `/api/eng/dashboard/overview` | GET | _role-gated in handler_ | Canonical engineering dashboard linked to project delivery. |
| Engineering | `/engineering/tasks` | `/api/eng/tasks` | GET | `eng_tasks:view` | Project-linked execution task board. |
| Quality | `/quality` | `/api/quality/dashboard` | GET | `quality:view` | Canonical quality workspace. |
| Quality (legacy alias, intentionally active) | `/quality/dashboard` | `/api/quality/dashboard` | GET | `quality:view` | Alias keeps older links live but lands on current quality surface. |
| Quality (legacy alias, intentionally active) | `/quality/ncrs` | `/api/quality/ncrs` | GET | `quality:view` | Legacy NCR list links kept active. |
| Commissioning | `/commissioning-dashboard` | `/api/commissioning-dashboard/:projectId` | GET | `commissioning:view` | Project-scoped dashboard in Quality nav domain. |
| Commissioning | `/commissioning-dashboard/:projectId` | `/api/commissioning-dashboard/:projectId` | GET | `commissioning:view` | Deep-link project dashboard. |
| Commissioning | `/commissioning-dashboard/:projectId` | `/api/commissioning/project/:projectId` | GET | `commissioning:view` | Backing commissioning item retrieval per project. |

## Explicitly checked guardrails

- Placeholder extracted files remain unmounted (`server/routes/engineering.routes.ts`, `server/routes/quality.routes.ts`).
- Alias behavior remains intact for `/quality/dashboard`, `/quality/ncrs`, `/quality/ncr/:id`, and `/standups`.
- No workflow, UI, or permission-rule changes are introduced by this smoke proof.

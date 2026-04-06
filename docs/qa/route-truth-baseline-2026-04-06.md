# Route Truth Baseline (Refreshed 2026-04-06)

## Canonical sources

- `client/src/config/page-registry.ts`
- `client/src/config/app-route-plan.ts`
- `client/src/config/route-components.tsx`
- `client/src/App.tsx`

## Current route metrics

| metric                                            | current count | previous (phase-0 snapshot) | delta |
| ------------------------------------------------- | ------------: | --------------------------: | ----: |
| Page routes                                       |           117 |                         117 |     0 |
| Alias routes (registry redirect + inline aliases) |             9 |                          21 |   -12 |
| Legacy redirects (`LEGACY_REDIRECTS`)             |            13 |                          13 |     0 |

## Active alias routes (retained)

| source path            | canonical destination          | reason                      | owner                 | removal trigger                    |
| ---------------------- | ------------------------------ | --------------------------- | --------------------- | ---------------------------------- |
| `/revenue`             | `/revenue-tracker`             | historical finance bookmark | Finance product owner | no accesses for 2 release cycles   |
| `/cos-control`         | `/cos`                         | historical finance bookmark | Finance product owner | no accesses for 2 release cycles   |
| `/cashflow-forecast`   | `/cashflow`                    | historical finance bookmark | Finance product owner | no accesses for 2 release cycles   |
| `/company-priorities`  | `/priorities`                  | renamed section path        | PMO                   | no external references             |
| `/execution-dashboard` | `/execution-board`             | old PM naming               | PMO                   | no external references             |
| `/pd/dashboard`        | `/pd`                          | old PD naming               | PD owner              | no external references             |
| `/pd/clients`          | `/clients`                     | old PD nav path             | PD owner              | no external references             |
| `/department-scores`   | `/leaderboard?tab=departments` | merged scoring view         | Knowledge owner       | leaderboard tab migration complete |
| `/hse/compliance`      | `/hse?tab=compliance`          | tab deep-link compatibility | HSE owner             | no external references             |

## Legacy redirects (`LEGACY_REDIRECTS`)

| source path               | canonical destination   |
| ------------------------- | ----------------------- |
| `/dashboard`              | `/gates`                |
| `/my-tool`                | `/`                     |
| `/my-tool/week`           | `/my-work/calendar`     |
| `/my-tool/backlog`        | `/my-work/tasks`        |
| `/my-tool/settings`       | `/my-work/settings`     |
| `/my-tool/help`           | `/`                     |
| `/my-tool/meetings`       | `/my-work/meetings`     |
| `/admin`                  | `/admin/control-center` |
| `/admin/legacy-utilities` | `/admin/control-center` |
| `/exceptions`             | `/gates/exceptions`     |
| `/sseg`                   | `/handover?tab=sseg`    |
| `/finance/home`           | `/finance/records`      |
| `/governance`             | `/governance/processes` |

## Alias routes removed in this cleanup

- `/quality/dashboard`
- `/quality/ncrs`
- `/quality/ncr/:id`
- `/standups`
- `/teams/chats`
- `/collaboration`
- `/collaboration/email`
- `/collaboration/teams`
- `/my-work/approvals`
- `/pm/approvals`
- `/procurement`
- `/command-center`

## Remaining route debt

- Role-permission audit evidence file is still manually produced (`qa/reports/role-permission-audit.md (from qa/role-permission-audit.template.md)`).
- KPI release evidence still depends on business-approved values in `qa/kpi-frozen-dataset.json`.

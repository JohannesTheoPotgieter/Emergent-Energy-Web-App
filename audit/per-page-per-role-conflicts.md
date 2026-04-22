# Per-Page × Per-Role Conflicts (sidebar-grounded)

**Sources:** `PAGE_REGISTRY` (138 entries, 115 non-alias) intersected with `TOP_SECTIONS.secondary` (49 actual sidebar paths) × 17 roles.

**Excluded:** 23 alias entries (`type === "alias"`) — these are pure redirects with no permission surface of their own. Sidebar links that target an alias path resolve via the alias's destination, which is itself a non-alias entry covered by this matrix.

**Conflict definition:** the path is in the sidebar (TOP_SECTIONS.secondary), the role's section is allowed, an entity is mapped, but the role is not in `entity.view_roles`.

**Methodology note.** This is a *policy-baseline* analysis. A "conflict" here means the role would be denied by the entity-rule policy (`ENTITY_PERMISSION_DEFAULTS`) — but individual endpoints may layer additional gates (project-membership, named middleware) or, conversely, fail to apply the entity rule at all. Runtime confirmation lives in `audit/runtime-probes.md`; treat this matrix as a starting set of *suspected* clickable-but-denied sidebar links rather than a definitive runtime behaviour map.

**Scope.** Expanded from the original foundation-audit chat deliverable to include on-disk artefacts: this matrix + the runtime probes. §6 behavioural fixes (procurement sidebar leakage, COO_SUPER_ADMIN labelling, eng_stages delete drift, requirePriorityAdmin policy registration) are intentionally not applied here — they are tracked as separate follow-up tasks.

**Total conflicts:** 50


## COO_ADMIN — 0 conflicts

_None._

## CEO_ADMIN — 0 conflicts

_None._

## CCO — 0 conflicts

_None._

## CFO — 3 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/pm-dashboard` | PM Dashboard | `pm_dashboard` | PROJECT_DELIVERY |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |
| `/handover` | Handover & Closeout | `handover` | PROJECT_DELIVERY |

## PROGRAM_MANAGER — 1 conflict

| Path | Label | Entity | Section |
|---|---|---|---|
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |

## PROGRAM_FINANCE_MANAGER — 1 conflict

| Path | Label | Entity | Section |
|---|---|---|---|
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |

## CONSTRUCTION_MANAGER — 6 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/cashflow` | Cashflow | `cashflow` | FINANCE |
| `/cos` | COS | `cos` | FINANCE |
| `/revenue-tracker` | Revenue | `revenue_tracker` | FINANCE |
| `/finance/quickbooks` | QB Throughput | `financials` | FINANCE |
| `/portfolios` | Portfolios | `portfolios` | PROJECT_DELIVERY |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |

## QUALITY_MANAGER — 6 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/portfolios` | Portfolios | `portfolios` | PROJECT_DELIVERY |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |
| `/po-approval-board` | PO Approvals | `procurement` | PROJECT_DELIVERY |
| `/payment-request-board` | Payment Requests | `procurement` | PROJECT_DELIVERY |
| `/payment-batch-manager` | Payment Batches | `procurement` | PROJECT_DELIVERY |
| `/handover` | Handover & Closeout | `handover` | PROJECT_DELIVERY |

## ENGINEERING_MANAGER — 6 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/portfolios` | Portfolios | `portfolios` | PROJECT_DELIVERY |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |
| `/po-approval-board` | PO Approvals | `procurement` | PROJECT_DELIVERY |
| `/payment-request-board` | Payment Requests | `procurement` | PROJECT_DELIVERY |
| `/payment-batch-manager` | Payment Batches | `procurement` | PROJECT_DELIVERY |
| `/handover` | Handover & Closeout | `handover` | PROJECT_DELIVERY |

## KEY_ACCOUNTS_MANAGER — 4 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/cashflow` | Cashflow | `cashflow` | FINANCE |
| `/cos` | COS | `cos` | FINANCE |
| `/revenue-tracker` | Revenue | `revenue_tracker` | FINANCE |
| `/finance/quickbooks` | QB Throughput | `financials` | FINANCE |

## ACCOUNTANT — 0 conflicts

_None._

## ENGINEER — 1 conflict

| Path | Label | Entity | Section |
|---|---|---|---|
| `/quality` | Quality | `quality` | QUALITY |

## PROJECT_MANAGER_SITE — 6 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/revenue-tracker` | Revenue | `revenue_tracker` | FINANCE |
| `/finance/quickbooks` | QB Throughput | `financials` | FINANCE |
| `/portfolios` | Portfolios | `portfolios` | PROJECT_DELIVERY |
| `/po-approval-board` | PO Approvals | `procurement` | PROJECT_DELIVERY |
| `/payment-request-board` | Payment Requests | `procurement` | PROJECT_DELIVERY |
| `/payment-batch-manager` | Payment Batches | `procurement` | PROJECT_DELIVERY |

## PROJECT_DEVELOPER — 4 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/cashflow` | Cashflow | `cashflow` | FINANCE |
| `/cos` | COS | `cos` | FINANCE |
| `/revenue-tracker` | Revenue | `revenue_tracker` | FINANCE |
| `/finance/quickbooks` | QB Throughput | `financials` | FINANCE |

## HSE_MANAGER — 5 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/portfolios` | Portfolios | `portfolios` | PROJECT_DELIVERY |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |
| `/po-approval-board` | PO Approvals | `procurement` | PROJECT_DELIVERY |
| `/payment-request-board` | Payment Requests | `procurement` | PROJECT_DELIVERY |
| `/payment-batch-manager` | Payment Batches | `procurement` | PROJECT_DELIVERY |

## SSEG_MANAGER — 7 conflicts

| Path | Label | Entity | Section |
|---|---|---|---|
| `/engineering/tasks` | Task Board | `eng_tasks` | ENGINEERING |
| `/portfolios` | Portfolios | `portfolios` | PROJECT_DELIVERY |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | PROJECT_DELIVERY |
| `/po-approval-board` | PO Approvals | `procurement` | PROJECT_DELIVERY |
| `/payment-request-board` | Payment Requests | `procurement` | PROJECT_DELIVERY |
| `/payment-batch-manager` | Payment Batches | `procurement` | PROJECT_DELIVERY |
| `/handover` | Handover & Closeout | `handover` | PROJECT_DELIVERY |

## COO_SUPER_ADMIN — 0 conflicts

_None._

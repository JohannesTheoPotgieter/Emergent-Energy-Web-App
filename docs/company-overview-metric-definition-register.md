# Company Overview Metric Definition Register

This register covers all visible KPI tiles/widgets on the Company Overview page after Phase 2B trust hardening.

| Label | Formula | SQL/Data source | Owner | Time basis | Thresholds | Drilldown target | Trust status | Visible |
|---|---|---|---|---|---|---|---|---|
| Active Projects | Count of projects with execution state `ACTIVE` | `project_info` + `project_execution_state` | PMO / Project Delivery | As-of now | None | `/gates` | Trusted | Yes |
| Blocked Gates | Count of stage requirements where `blocks_gate=true` and status not complete/approved | `project_stage_requirements` (+ stage/project lookup) | Project Delivery | As-of now | `>0` requires action | `/gates/blocked` | Trusted | Yes |
| Overdue Items | Count of active-project work items where due date `< today` and status not complete/cancelled | `work_items` | Project Delivery | Daily | `>0` requires action | `/gates/exceptions` | Trusted | Yes |
| Missing Weekly Updates | Count of active projects without client update in last 7 days | `client_updates` + `project_info` | Project Delivery / PMs | Rolling 7 days | `>0` requires action | `/gates/client-updates` | Trusted | Yes |
| Portfolio Delivery: Active Projects | Same as Active Projects | `project_info` + `project_execution_state` | PMO | As-of now | None | `/gates` | Trusted | Yes |
| Portfolio Delivery: On/At/Off Track split | Counts by effective RAG bucket over active projects | `project_execution_state` + effective RAG rule | PMO | As-of now | None | `/gates` | Trusted | Yes |
| Portfolio Delivery: Upcoming Milestones (14d) | Count of active-project milestone work items due within `[today, today+14]` | `work_items` | PMO / Project Delivery | Rolling 14 days | None | `/gates` | Trusted | Yes |
| Portfolio Delivery: Practical Completion Due (month) | Count of active projects with practical completion target in current month | `project_execution_state` | PMO | Current month | None | `/gates` | Trusted | Yes |
| Portfolio Delivery: Handovers Due (month) | Count of active projects with client handover date in current month | `project_execution_state` | PMO | Current month | None | `/gates/handovers` | Trusted | Yes |
| Finance: Revenue Realised FYTD | COS-ratio allocated realised revenue from realised COS lines in FY window | `normalized_cost_lines` + `normalized_revenue_lines` | Finance | FYTD | None (target KPIs hidden) | `/cashflow` | Conditional (depends on lineage/null quality) | Yes |
| Finance: COS Realised FYTD | Sum of realised COS in FY window via invoice-actuals rule | `normalized_cost_lines` (+ allocation evidence) | Finance | FYTD | None (target KPIs hidden) | `/cashflow` | Conditional | Yes |
| Finance: Gross Margin % | Margin over realised FYTD revenue/COS | Derived from realised revenue and realised COS | Finance | FYTD | None (target KPI hidden) | `/cashflow` | Conditional | Yes |
| Finance: Cash Collection Rate | `cashReceivedFytd / totalRevenueFytd` | `normalized_revenue_lines` | Finance | FYTD | None | `/cashflow` | Conditional | Yes |
| Finance: Cash Received FYTD | Sum of settled revenue amounts in FY | `normalized_revenue_lines` | Finance | FYTD | None | `/cashflow` | Conditional | Yes |
| Finance: Cash Paid FYTD | Sum of cost lines with paid date in FY | `normalized_cost_lines` | Finance | FYTD | None | `/cashflow` | Conditional | Yes |
| Finance: Overdue Debtors | Sum of overdue receivables from AR status evaluation | `normalized_revenue_lines` | Finance | As-of now | `>0` requires action | `/cashflow` | Conditional | Yes |
| Top Risks / Exceptions | Ordered exception list from blocked gates, overdue tasks, missing updates | `project_stage_requirements`, `work_items`, `client_updates` | Project Delivery | As-of now | Severity ordered | `/gates/exceptions` | Trusted | Yes |
| Company Priorities | Open company priorities sorted by overdue/rank | `mytool_company_priorities` | EXCO / COO | As-of now | None | `/priorities`, `/priorities/:id` | Conditional (manual fields) | Yes |
| Recent Signals | Last-7-day event feed from blocked gates, overdue corrective actions, missing updates | Stage requirements, corrective actions, client updates | COO office / PMO | Rolling 7 days | None | Related gate/exception surfaces | Trusted | Yes |

## Hard-hidden KPIs (Phase 2B)

These are hidden from Company Overview widgets/tables because they are proxy-target or null-model KPIs:

- `pd_signed_pipeline_vs_target`
- `fin_revenue_vs_target`
- `fin_cash_collected_vs_target`
- `fin_cos_vs_target`
- `fin_gross_margin_vs_target`
- `hse_site_audit_pass_rate`
- `hse_toolbox_compliance`
- `hse_safety_file_completeness`


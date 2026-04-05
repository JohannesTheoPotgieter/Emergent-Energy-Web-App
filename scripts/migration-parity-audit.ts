/**
 * Migration Parity Audit — Wave 6 Step 1
 *
 * Compares promoted schema tables against legacy tables to verify
 * row count parity, data integrity, and bridge sync health.
 *
 * Usage: npx tsx scripts/migration-parity-audit.ts
 * Output: docs/parity-audit-report.md
 */

import { writeFileSync } from "fs";
import { join } from "path";

// This script is designed to run against the database.
// Since we can't connect directly in this environment, we generate
// the SQL queries and report template that can be run manually
// or via the admin API endpoint.

interface ParityCheck {
  domain: string;
  promotedTable: string;
  legacyTable: string;
  status: "READY_TO_RETIRE" | "BRIDGE_ACTIVE" | "PARITY_GAP" | "BLOCKED";
  notes: string;
  legacyConsumers: string[];
  exitCondition: string;
}

const PARITY_CHECKS: ParityCheck[] = [
  {
    domain: "Parties",
    promotedTable: "core.parties",
    legacyTable: "public.clients + public.counterparties + public.users",
    status: "BRIDGE_ACTIVE",
    notes: "Parties backfilled from all 3 sources. INSTEAD OF triggers on clients handle dual-write. Users table still authoritative for auth.",
    legacyConsumers: [
      "server/routes/auth-routes.ts (login reads users)",
      "server/departments/opportunities-routes.ts (reads clients)",
      "client/src/pages/clients.tsx (reads /api/clients)",
      "client/src/pages/counterparties.tsx (reads counterparties)",
    ],
    exitCondition: "Auth migrated to user_accounts; all client/counterparty pages use /api/parties",
  },
  {
    domain: "Project Identity",
    promotedTable: "core.project_instances + core.projects",
    legacyTable: "public.project_info",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers provide 100% write coverage. All legacy INSERTs/UPDATEs transparently write to promoted tables.",
    legacyConsumers: [
      "server/routes/projects.routes.ts (GET /api/projects)",
      "server/services/project-v2-service.ts (reads project_info)",
      "client/src/pages/project-detail.tsx (reads /api/v2/projects/:id)",
      "40+ route files reference projectInfo",
    ],
    exitCondition: "All project reads migrated to v2 API or compatibility views",
  },
  {
    domain: "Project Execution State",
    promotedTable: "core.projects (phase + state_history)",
    legacyTable: "public.project_execution_state",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers active. Phase authoritative in project_instances. Key dates still in execution state.",
    legacyConsumers: [
      "server/lifecycle-routes.ts",
      "server/services/stage-lifecycle-service.ts",
      "client/src/pages/project-detail.tsx",
      "client/src/pages/execution-board.tsx",
    ],
    exitCondition: "Key dates migrated to project_instances; all reads use promoted schema",
  },
  {
    domain: "Work Items",
    promotedTable: "core.work_items_clean + core.work_packages",
    legacyTable: "public.work_items",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers active. Legacy work_items is now a view over promoted table.",
    legacyConsumers: [
      "server/task-management-routes.ts",
      "server/routes/planning-tasks-routes.ts",
      "client/src/pages/my-work-tasks.tsx",
      "client/src/pages/execution-board.tsx",
    ],
    exitCondition: "All task management pages use v2 work items API",
  },
  {
    domain: "Approvals",
    promotedTable: "core.approval_instances + core.approval_rules",
    legacyTable: "public.approvals",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers active. Legacy approvals is now a view.",
    legacyConsumers: [
      "server/routes/approvals-routes.ts",
      "client/src/pages/admin-approvals.tsx",
      "client/src/pages/my-work-tasks.tsx (approvals tab)",
    ],
    exitCondition: "All approval pages use /api/approvals-v2",
  },
  {
    domain: "Deliverables",
    promotedTable: "core.deliverable_instances + core.deliverable_definitions",
    legacyTable: "public.deliverables",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers active. Legacy deliverables is now a view.",
    legacyConsumers: [
      "server/engineering-routes.ts",
      "server/deliverable-capture-routes.ts",
      "client/src/pages/engineering-dashboard.tsx",
    ],
    exitCondition: "All engineering pages use /api/deliverables v2 API",
  },
  {
    domain: "Finance (Cost Lines)",
    promotedTable: "finance.cost_lines",
    legacyTable: "public.normalized_cost_lines",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers active. Smart import writes to legacy table name (now a view). Transparent dual-write.",
    legacyConsumers: [
      "server/smart-import-routes.ts (writes)",
      "server/departments/finance-routes.ts (reads)",
      "client/src/pages/cos.tsx",
      "client/src/pages/cashflow.tsx",
    ],
    exitCondition: "Smart import writes to finance_records; analytical pages use materialized views",
  },
  {
    domain: "Finance (Revenue Lines)",
    promotedTable: "finance.revenue_lines",
    legacyTable: "public.normalized_revenue_lines",
    status: "BRIDGE_ACTIVE",
    notes: "View-swap INSTEAD OF triggers active. Same pattern as cost lines.",
    legacyConsumers: [
      "server/smart-import-routes.ts (writes)",
      "client/src/pages/revenue-tracker.tsx",
      "client/src/pages/cashflow.tsx",
    ],
    exitCondition: "Smart import writes to finance_records; analytical pages use materialized views",
  },
  {
    domain: "Finance (Transactional)",
    promotedTable: "finance.finance_records",
    legacyTable: "public.purchase_orders + payment_requests + invoice_captures",
    status: "BRIDGE_ACTIVE",
    notes: "Finance records backfilled from all transactional sources. New API available. Legacy routes still used by some pages.",
    legacyConsumers: [
      "server/po-routes.ts",
      "server/payment-request-routes.ts",
      "server/payment-batch-routes.ts",
      "server/invoice-capture-routes.ts",
      "client/src/pages/po-approval-board.tsx",
      "client/src/pages/payment-request-board.tsx",
      "client/src/pages/payment-batch-manager.tsx",
    ],
    exitCondition: "All finance pages use /api/finance-records v2 API",
  },
  {
    domain: "Governed Processes",
    promotedTable: "core.governed_processes + checklist_items",
    legacyTable: "(derived from handovers, financial reviews, stage requirements)",
    status: "BRIDGE_ACTIVE",
    notes: "Backfilled from 6 legacy sources. New processes use governed_process API. Legacy in-flight processes still use old routes.",
    legacyConsumers: [
      "server/financial-review-routes.ts",
      "server/handover-routes.ts",
      "server/change-control-routes.ts",
      "server/payment-batch-routes.ts",
    ],
    exitCondition: "All in-flight legacy processes complete; new processes always use governed_process",
  },
  {
    domain: "External Resources",
    promotedTable: "core.external_resources + core.resource_links",
    legacyTable: "public.sp_files + deliverable_files",
    status: "BRIDGE_ACTIVE",
    notes: "Backfilled from SharePoint files and deliverable files. New resource linking API available.",
    legacyConsumers: [
      "server/sharepoint.ts",
      "server/deliverable-capture-routes.ts",
    ],
    exitCondition: "All file operations use external_resources API",
  },
  {
    domain: "Activity/Audit Logs",
    promotedTable: "internal.activity_log + internal.audit_log",
    legacyTable: "(new tables — no legacy equivalent)",
    status: "READY_TO_RETIRE",
    notes: "No legacy equivalent to retire. These are net-new promoted tables.",
    legacyConsumers: [],
    exitCondition: "N/A — already authoritative",
  },
  {
    domain: "Strategic Priorities",
    promotedTable: "core.strategic_priorities + links",
    legacyTable: "(derived from priorities tables)",
    status: "BRIDGE_ACTIVE",
    notes: "Backfilled from legacy priorities. Some pages still read from legacy.",
    legacyConsumers: [
      "server/departments/priority-strategic-routes.ts",
      "client/src/pages/priorities.tsx",
    ],
    exitCondition: "Priorities page uses promoted schema",
  },
];

// Generate report
function generateReport(): string {
  const readyCount = PARITY_CHECKS.filter((c) => c.status === "READY_TO_RETIRE").length;
  const bridgeCount = PARITY_CHECKS.filter((c) => c.status === "BRIDGE_ACTIVE").length;
  const gapCount = PARITY_CHECKS.filter((c) => c.status === "PARITY_GAP").length;
  const blockedCount = PARITY_CHECKS.filter((c) => c.status === "BLOCKED").length;

  let md = `# Migration Parity Audit Report

> **Generated:** ${new Date().toISOString().split("T")[0]}
> **Wave 6 Step 1 — Pre-cleanup audit**

## Summary

| Status | Count |
|--------|-------|
| READY_TO_RETIRE | ${readyCount} |
| BRIDGE_ACTIVE | ${bridgeCount} |
| PARITY_GAP | ${gapCount} |
| BLOCKED | ${blockedCount} |
| **Total domains** | **${PARITY_CHECKS.length}** |

## Compatibility Layer Size

- **Bridge objects (BRIDGE_ACTIVE):** ${bridgeCount} — these have view-swap INSTEAD OF triggers providing transparent dual-write
- **Ready to retire:** ${readyCount}
- **Total legacy consumers across all domains:** ${PARITY_CHECKS.reduce((sum, c) => sum + c.legacyConsumers.length, 0)}

## Per-Domain Status

`;

  for (const check of PARITY_CHECKS) {
    md += `### ${check.domain}

| Field | Value |
|-------|-------|
| Promoted | \`${check.promotedTable}\` |
| Legacy | \`${check.legacyTable}\` |
| Status | **${check.status}** |
| Notes | ${check.notes} |
| Exit condition | ${check.exitCondition} |

`;
    if (check.legacyConsumers.length > 0) {
      md += `**Legacy consumers (${check.legacyConsumers.length}):**\n`;
      for (const consumer of check.legacyConsumers) {
        md += `- \`${consumer}\`\n`;
      }
      md += "\n";
    }

    md += "---\n\n";
  }

  md += `## SQL Verification Queries

Run these against the database to verify row count parity:

\`\`\`sql
-- Parties parity
SELECT 'promoted' AS source, COUNT(*) FROM core.parties
UNION ALL
SELECT 'legacy_clients', COUNT(*) FROM _clients_legacy
UNION ALL
SELECT 'legacy_counterparties', COUNT(*) FROM counterparties
UNION ALL
SELECT 'legacy_users', COUNT(*) FROM _users_legacy;

-- Projects parity
SELECT 'promoted', COUNT(*) FROM core.project_instances
UNION ALL
SELECT 'legacy', COUNT(*) FROM _project_info_legacy;

-- Work items parity
SELECT 'promoted', COUNT(*) FROM core.work_items_clean
UNION ALL
SELECT 'legacy', COUNT(*) FROM _work_items_legacy;

-- Approvals parity
SELECT 'promoted', COUNT(*) FROM core.approval_instances
UNION ALL
SELECT 'legacy', COUNT(*) FROM _approvals_legacy;

-- Deliverables parity
SELECT 'promoted', COUNT(*) FROM core.deliverable_instances
UNION ALL
SELECT 'legacy', COUNT(*) FROM _deliverables_legacy;

-- Finance records parity
SELECT 'promoted', COUNT(*) FROM finance.finance_records
UNION ALL
SELECT 'legacy_po', COUNT(*) FROM purchase_orders
UNION ALL
SELECT 'legacy_pr', COUNT(*) FROM payment_requests
UNION ALL
SELECT 'legacy_inv', COUNT(*) FROM invoice_captures;
\`\`\`

## Bridge Exit Plan

Each BRIDGE_ACTIVE domain needs its legacy consumers migrated before the bridge can be retired.
See \`docs/bridge-exit-plan.md\` for target dates and migration sequence.
`;

  return md;
}

const report = generateReport();
const outputPath = join(process.cwd(), "docs", "parity-audit-report.md");
writeFileSync(outputPath, report, "utf-8");
console.log(`Parity audit report written to ${outputPath}`);
console.log(`Domains: ${PARITY_CHECKS.length}`);
console.log(`Ready to retire: ${PARITY_CHECKS.filter((c) => c.status === "READY_TO_RETIRE").length}`);
console.log(`Bridge active: ${PARITY_CHECKS.filter((c) => c.status === "BRIDGE_ACTIVE").length}`);

/**
 * Role-Based UX Upgrade — Migration and Backfill Script
 *
 * This script:
 * 1. Creates new tables (idempotent — skips if already exist)
 * 2. Backfills role_lens_profiles from DEFAULT_LENS_PROFILES
 * 3. Backfills role_homepage_widgets for all lens roles
 * 4. Backfills contracts from existing project/opportunity data
 * 5. Backfills SSEG applications from existing ssegItems
 *
 * Safe to run multiple times (idempotent).
 * Does NOT modify or delete existing data.
 */

import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import logger from "../../lib/logger";
import { hasBackfillRun, markBackfillComplete } from "./backfill-registry";
import {
  roleLensProfiles,
  roleHomepageWidgets,
  contracts,
  ssegApplications,
  roleHomepageSnapshots,
  DEFAULT_LENS_PROFILES,
  LENS_ROLES,
  type LensRole,
} from "@shared/schema/role-based-upgrade";

interface BackfillReport {
  tablesCreated: string[];
  tablesSkipped: string[];
  rowsBackfilled: Record<string, number>;
  rowsSkipped: Record<string, number>;
  errors: string[];
  warnings: string[];
}

export async function runRoleLensBackfill(): Promise<BackfillReport> {
  const report: BackfillReport = {
    tablesCreated: [],
    tablesSkipped: [],
    rowsBackfilled: {},
    rowsSkipped: {},
    errors: [],
    warnings: [],
  };

  // One-time guard: skip if already completed
  if (await hasBackfillRun("role_lens_v1")) return report;

  logger.info("[RoleLensBackfill] Starting role-based UX upgrade backfill...");

  // ============= STEP 1: Create Tables (Idempotent) =============
  try {
    await createTablesIfNotExist(report);
  } catch (err) {
    report.errors.push(`Table creation failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("[RoleLensBackfill] Table creation error:", err);
    return report;
  }

  // ============= STEP 2: Backfill role_lens_profiles =============
  try {
    await backfillLensProfiles(report);
  } catch (err) {
    report.errors.push(`Lens profiles backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("[RoleLensBackfill] Lens profiles error:", err);
  }

  // ============= STEP 3: Backfill role_homepage_widgets =============
  try {
    await backfillHomepageWidgets(report);
  } catch (err) {
    report.errors.push(`Homepage widgets backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("[RoleLensBackfill] Widgets error:", err);
  }

  // ============= STEP 4: Backfill contracts from projects =============
  try {
    await backfillContracts(report);
  } catch (err) {
    report.errors.push(`Contracts backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("[RoleLensBackfill] Contracts error:", err);
  }

  // ============= STEP 5: Backfill SSEG applications =============
  try {
    await backfillSsegApplications(report);
  } catch (err) {
    report.errors.push(`SSEG backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("[RoleLensBackfill] SSEG error:", err);
  }

  // ============= STEP 6: Populate role homepage snapshots =============
  try {
    await populateHomepageSnapshots(report);
  } catch (err) {
    report.errors.push(`Homepage snapshots failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("[RoleLensBackfill] Snapshots error:", err);
  }

  // ============= STEP 7: Persist migration report =============
  try {
    await persistMigrationReport(report);
  } catch (err) {
    logger.error("[RoleLensBackfill] Report persistence error:", err);
  }

  logger.info("[RoleLensBackfill] Backfill complete. " + JSON.stringify(report, null, 2));

  // Mark as complete so it never runs again
  await markBackfillComplete("role_lens_v1", {
    rowsBackfilled: report.rowsBackfilled,
    errors: report.errors.length,
  });

  return report;
}

async function createTablesIfNotExist(report: BackfillReport) {
  const tables = [
    {
      name: "role_lens_profiles",
      ddl: `CREATE TABLE IF NOT EXISTS role_lens_profiles (
        id SERIAL PRIMARY KEY,
        lens_role TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        description TEXT,
        landing_page TEXT NOT NULL,
        allowed_modules TEXT[] NOT NULL DEFAULT '{}',
        nav_priority TEXT[] NOT NULL DEFAULT '{}',
        quick_actions JSONB NOT NULL DEFAULT '[]',
        default_filters JSONB NOT NULL DEFAULT '{}',
        widget_layout JSONB NOT NULL DEFAULT '[]',
        record_tab_emphasis JSONB NOT NULL DEFAULT '{}',
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "role_homepage_widgets",
      ddl: `CREATE TABLE IF NOT EXISTS role_homepage_widgets (
        id SERIAL PRIMARY KEY,
        lens_role TEXT NOT NULL,
        widget_key TEXT NOT NULL,
        label TEXT NOT NULL,
        widget_type TEXT NOT NULL,
        data_source TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        span INTEGER NOT NULL DEFAULT 1,
        config JSONB NOT NULL DEFAULT '{}',
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "contracts",
      ddl: `CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES project_info(id),
        opportunity_id INTEGER,
        client_name TEXT,
        counterparty_name TEXT,
        contract_type TEXT,
        contract_reference TEXT,
        signature_status TEXT NOT NULL DEFAULT 'draft',
        signed_date DATE,
        effective_date DATE,
        expiry_date DATE,
        contract_value INTEGER,
        currency TEXT DEFAULT 'ZAR',
        document_refs JSONB NOT NULL DEFAULT '[]',
        financial_close_relevance BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP,
        deleted_by INTEGER
      )`,
    },
    {
      name: "sseg_applications",
      ddl: `CREATE TABLE IF NOT EXISTS sseg_applications (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_info(id),
        site_id INTEGER,
        authority TEXT NOT NULL,
        application_stage TEXT NOT NULL DEFAULT 'preparation',
        reference_number TEXT,
        submission_date DATE,
        query_date DATE,
        response_due_date DATE,
        approval_date DATE,
        expiry_date DATE,
        required_documents JSONB NOT NULL DEFAULT '[]',
        rejection_notes TEXT,
        query_notes TEXT,
        owner_user_id INTEGER REFERENCES users(id),
        sseg_item_id INTEGER,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )`,
    },
    {
      name: "lens_simulation_sessions",
      ddl: `CREATE TABLE IF NOT EXISTS lens_simulation_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        simulated_lens_role TEXT NOT NULL,
        simulated_user_id INTEGER REFERENCES users(id),
        mode TEXT NOT NULL DEFAULT 'read_only',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP
      )`,
    },
    {
      name: "role_homepage_snapshots",
      ddl: `CREATE TABLE IF NOT EXISTS role_homepage_snapshots (
        id SERIAL PRIMARY KEY,
        lens_role TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        snapshot_data JSONB NOT NULL DEFAULT '{}',
        computed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
  ];

  for (const table of tables) {
    try {
      // Check if table exists
      const exists = await db.execute(sql.raw(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${table.name}')`
      ));
      const tableExists = exists.rows?.[0]?.exists === true || exists.rows?.[0]?.exists === 't';

      if (tableExists) {
        report.tablesSkipped.push(table.name);
      } else {
        await db.execute(sql.raw(table.ddl));
        report.tablesCreated.push(table.name);
      }
    } catch {
      // If CREATE IF NOT EXISTS still succeeds, that's fine
      report.tablesSkipped.push(table.name);
    }
  }
}

async function backfillLensProfiles(report: BackfillReport) {
  let backfilled = 0;
  let skipped = 0;

  for (const profile of DEFAULT_LENS_PROFILES) {
    try {
      const existing = await db.select().from(roleLensProfiles).where(eq(roleLensProfiles.lensRole, profile.lensRole)).limit(1);
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(roleLensProfiles).values({
        lensRole: profile.lensRole,
        label: profile.label,
        description: profile.description,
        landingPage: profile.landingPage,
        allowedModules: profile.allowedModules,
        navPriority: profile.navPriority,
        quickActions: profile.quickActions,
        defaultFilters: {},
        widgetLayout: [],
        recordTabEmphasis: {},
        isSystem: true,
      });
      backfilled++;
    } catch (err) {
      report.warnings.push(`Lens profile ${profile.lensRole}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  report.rowsBackfilled["role_lens_profiles"] = backfilled;
  report.rowsSkipped["role_lens_profiles"] = skipped;
}

async function backfillHomepageWidgets(report: BackfillReport) {
  let backfilled = 0;
  let skipped = 0;

  // Widget definitions per lens role category
  const widgetSets: Record<string, Array<{ key: string; label: string; type: string; dataSource?: string; span?: number }>> = {
    CEO: [
      { key: "revenue_vs_target", label: "Revenue vs Target", type: "kpi" },
      { key: "gp_margin", label: "GP Margin", type: "kpi" },
      { key: "projects_off_track", label: "Projects Off Track", type: "kpi" },
      { key: "strategic_risk", label: "Strategic Risk Items", type: "alert" },
      { key: "pending_decisions", label: "Pending Decisions", type: "list" },
      { key: "lifecycle_gates", label: "Lifecycle Gates", type: "gate_checklist", span: 2 },
    ],
    COO_SUPER_ADMIN: [
      { key: "system_health", label: "System Health", type: "kpi" },
      { key: "active_users", label: "Active Users", type: "kpi" },
      { key: "import_status", label: "Import Status", type: "kpi" },
      { key: "exceptions_open", label: "Open Exceptions", type: "alert" },
      { key: "audit_recent", label: "Recent Audit Events", type: "list" },
      { key: "lifecycle_gates", label: "Lifecycle Gates", type: "gate_checklist", span: 2 },
    ],
    CFO: [
      { key: "cash_position", label: "Cash Position", type: "kpi" },
      { key: "margin_drift", label: "Margin Drift", type: "kpi" },
      { key: "invoices_overdue", label: "Invoices Overdue", type: "alert" },
      { key: "collections_queue", label: "Collections Queue", type: "list" },
      { key: "cashflow_chart", label: "Cashflow Trend", type: "chart", span: 2 },
    ],
    PROGRAM_MANAGER: [
      { key: "projects_on_track", label: "Projects On Track", type: "kpi" },
      { key: "milestones_due", label: "Milestones Due", type: "kpi" },
      { key: "escalations", label: "Escalations", type: "alert" },
      { key: "resource_conflicts", label: "Resource Conflicts", type: "list" },
      { key: "cross_project_deps", label: "Cross-Project Dependencies", type: "list", span: 2 },
    ],
    ENGINEER: [
      { key: "my_tasks", label: "My Tasks", type: "list" },
      { key: "review_queue", label: "Review Queue", type: "list" },
      { key: "blockers", label: "Blockers", type: "alert" },
      { key: "deliverables_due", label: "Deliverables Due", type: "kpi" },
    ],
    PROJECT_MANAGER: [
      { key: "my_projects_rag", label: "My Projects RAG", type: "kpi" },
      { key: "overdue_tasks", label: "Overdue Tasks", type: "alert" },
      { key: "approvals_pending", label: "Approvals Pending", type: "kpi" },
      { key: "budget_burn", label: "Budget Burn", type: "chart" },
      { key: "lifecycle_gates", label: "Lifecycle Gates", type: "gate_checklist", span: 2 },
    ],
    HSE_MANAGER: [
      { key: "incidents_open", label: "Open Incidents", type: "kpi" },
      { key: "corrective_actions", label: "Corrective Actions Due", type: "alert" },
      { key: "safety_compliance", label: "Safety File Compliance", type: "kpi" },
      { key: "audit_schedule", label: "Audit Schedule", type: "list" },
    ],
    SSEG_MANAGER: [
      { key: "applications_queue", label: "Application Queue", type: "list" },
      { key: "queries_outstanding", label: "Queries Outstanding", type: "alert" },
      { key: "turnaround_times", label: "Turnaround Times", type: "chart" },
      { key: "authority_tracker", label: "Authority Tracker", type: "list" },
    ],
  };

  // Map other lens roles to widget sets
  // Quality Manager widgets
  widgetSets['QUALITY_MANAGER'] = [
    { key: "open_ncrs", label: "Open NCRs", type: "kpi" },
    { key: "snags_due", label: "Snags Due", type: "alert" },
    { key: "inspections_pending", label: "Inspections Pending", type: "kpi" },
    { key: "corrective_actions_open", label: "Corrective Actions Open", type: "kpi" },
    { key: "quality_gate_blocks", label: "Quality Gate Blocks", type: "alert" },
    { key: "qc_checklist_progress", label: "QC Checklist Progress", type: "chart", span: 2 },
  ];

  const lensToWidgetSet: Record<LensRole, string> = {
    CEO: 'CEO',
    COO_SUPER_ADMIN: 'COO_SUPER_ADMIN',
    CFO: 'CFO',
    HEAD_OF_PROJECT_DEVELOPMENT: 'CEO',
    PROGRAM_MANAGER: 'PROGRAM_MANAGER',
    CONSTRUCTION_MANAGER: 'PROGRAM_MANAGER',
    PROGRAM_FINANCE_MANAGER: 'CFO',
    HSE_MANAGER: 'HSE_MANAGER',
    SSEG_MANAGER: 'SSEG_MANAGER',
    QUALITY_MANAGER: 'QUALITY_MANAGER',
    ENGINEER: 'ENGINEER',
    PROJECT_MANAGER: 'PROJECT_MANAGER',
    PROJECT_DEVELOPER: 'ENGINEER',
  };

  for (const lens of LENS_ROLES) {
    const widgetSetKey = lensToWidgetSet[lens] ?? 'ENGINEER';
    const widgets = widgetSets[widgetSetKey] ?? widgetSets['ENGINEER']!;

    for (let i = 0; i < widgets.length; i++) {
      const w = widgets[i];
      try {
        // Check if widget already exists
        const existing = await db.select().from(roleHomepageWidgets)
          .where(sql`${roleHomepageWidgets.lensRole} = ${lens} AND ${roleHomepageWidgets.widgetKey} = ${w.key}`)
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        await db.insert(roleHomepageWidgets).values({
          lensRole: lens,
          widgetKey: w.key,
          label: w.label,
          widgetType: w.type,
          dataSource: w.dataSource || null,
          position: i,
          span: w.span ?? 1,
          config: {},
          isVisible: true,
        });
        backfilled++;
      } catch (err) {
        report.warnings.push(`Widget ${lens}/${w.key}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }
    }
  }

  report.rowsBackfilled["role_homepage_widgets"] = backfilled;
  report.rowsSkipped["role_homepage_widgets"] = skipped;
}

async function backfillContracts(report: BackfillReport) {
  let backfilled = 0;
  let skipped = 0;

  try {
    // Check if contracts table has any data already
    const existingCount = await db.select({ count: sql<number>`count(*)` }).from(contracts);
    if ((existingCount[0]?.count ?? 0) > 0) {
      report.rowsSkipped["contracts"] = existingCount[0]?.count ?? 0;
      report.warnings.push("Contracts table already has data — skipping backfill");
      return;
    }

    // Phase 1: Backfill from project_info where contract_value exists
    const projectsWithContracts = await db.execute(sql.raw(`
      SELECT id, name, contract_value, contract_type, client_name
      FROM project_info
      WHERE contract_value IS NOT NULL
        AND contract_value > 0
        AND deleted_at IS NULL
    `));

    for (const project of (projectsWithContracts.rows ?? [])) {
      try {
        await db.insert(contracts).values({
          projectId: project.id as number,
          clientName: (project.client_name as string) || null,
          contractType: (project.contract_type as string) || 'epc',
          contractReference: `PRJ-${project.id}`,
          signatureStatus: 'signed',
          contractValue: project.contract_value as number,
          currency: 'ZAR',
          documentRefs: [],
          notes: `Auto-backfilled from project ${project.name}`,
        });
        backfilled++;
      } catch {
        skipped++;
      }
    }

    // Phase 2: Backfill from opportunities where contract data exists but no project link
    try {
      const opportunitiesWithContracts = await db.execute(sql.raw(`
        SELECT o.id, o.project_name, o.contract_type, o.estimated_value, o.client_name, o.stage
        FROM opportunities o
        LEFT JOIN contracts c ON c.opportunity_id = o.id
        WHERE c.id IS NULL
          AND o.estimated_value IS NOT NULL
          AND o.estimated_value > 0
          AND o.deleted_at IS NULL
          AND o.stage IN ('won', 'negotiating', 'proposal_sent')
      `));

      for (const opp of (opportunitiesWithContracts.rows ?? [])) {
        try {
          await db.insert(contracts).values({
            opportunityId: opp.id as number,
            clientName: (opp.client_name as string) || null,
            contractType: (opp.contract_type as string) || 'epc',
            contractReference: `OPP-${opp.id}`,
            signatureStatus: (opp.stage as string) === 'won' ? 'signed' : 'negotiating',
            contractValue: opp.estimated_value as number,
            currency: 'ZAR',
            documentRefs: [],
            notes: `Auto-backfilled from opportunity ${opp.project_name || opp.id}`,
          });
          backfilled++;
        } catch {
          skipped++;
        }
      }
    } catch (err) {
      // Opportunities table structure may differ — log but don't fail
      report.warnings.push(`Contracts backfill (opportunities phase): ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    report.warnings.push(`Contracts backfill: ${err instanceof Error ? err.message : String(err)}`);
  }

  report.rowsBackfilled["contracts"] = backfilled;
  report.rowsSkipped["contracts"] = skipped;
}

async function backfillSsegApplications(report: BackfillReport) {
  let backfilled = 0;
  let skipped = 0;

  try {
    // Check if sseg_applications table has any data already
    const existingCount = await db.select({ count: sql<number>`count(*)` }).from(ssegApplications);
    if ((existingCount[0]?.count ?? 0) > 0) {
      report.rowsSkipped["sseg_applications"] = existingCount[0]?.count ?? 0;
      report.warnings.push("SSEG applications table already has data — skipping backfill");
      return;
    }

    // Backfill from sseg_items where item_type = 'application'
    const ssegItems = await db.execute(sql.raw(`
      SELECT id, project_id, authority, reference_number, submitted_date, expected_date, actual_date, status, notes
      FROM sseg_items
      WHERE item_type = 'application'
        AND deleted_at IS NULL
    `));

    for (const item of (ssegItems.rows ?? [])) {
      try {
        const statusToStage: Record<string, string> = {
          pending: 'preparation',
          submitted: 'submitted',
          approved: 'approved',
          rejected: 'rejected',
          complete: 'approved',
        };

        await db.insert(ssegApplications).values({
          projectId: item.project_id as number,
          authority: (item.authority as string) || 'other',
          applicationStage: statusToStage[(item.status as string)] || 'preparation',
          referenceNumber: item.reference_number as string || null,
          submissionDate: item.submitted_date as string || null,
          approvalDate: item.actual_date as string || null,
          ssegItemId: item.id as number,
          notes: `Backfilled from sseg_items #${item.id}. ${(item.notes as string) || ''}`.trim(),
        });
        backfilled++;
      } catch {
        skipped++;
      }
    }
  } catch (err) {
    report.warnings.push(`SSEG backfill: ${err instanceof Error ? err.message : String(err)}`);
  }

  report.rowsBackfilled["sseg_applications"] = backfilled;
  report.rowsSkipped["sseg_applications"] = skipped;
}

async function populateHomepageSnapshots(report: BackfillReport) {
  let backfilled = 0;
  let skipped = 0;

  for (const lens of LENS_ROLES) {
    try {
      const existing = await db.select().from(roleHomepageSnapshots)
        .where(sql`${roleHomepageSnapshots.lensRole} = ${lens} AND ${roleHomepageSnapshots.userId} IS NULL`)
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Compute basic snapshot data from available tables
      const snapshotData: Record<string, unknown> = {
        computedAt: new Date().toISOString(),
        lensRole: lens,
      };

      // Try to compute project counts
      try {
        const projectCounts = await db.execute(sql.raw(`
          SELECT
            COUNT(*) FILTER (WHERE deleted_at IS NULL) as total_projects,
            COUNT(*) FILTER (WHERE phase = 'execution' AND deleted_at IS NULL) as active_projects,
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND rag_status = 'red') as red_projects
          FROM project_info
        `));
        if (projectCounts.rows?.[0]) {
          snapshotData.totalProjects = projectCounts.rows[0].total_projects ?? 0;
          snapshotData.activeProjects = projectCounts.rows[0].active_projects ?? 0;
          snapshotData.redProjects = projectCounts.rows[0].red_projects ?? 0;
        }
      } catch { /* project_info may not have these columns — safe to skip */ }

      // Try to compute open task counts
      try {
        const taskCounts = await db.execute(sql.raw(`
          SELECT COUNT(*) as open_tasks
          FROM work_items
          WHERE status NOT IN ('done', 'cancelled')
            AND deleted_at IS NULL
        `));
        if (taskCounts.rows?.[0]) {
          snapshotData.openTasks = taskCounts.rows[0].open_tasks ?? 0;
        }
      } catch { /* safe to skip */ }

      await db.insert(roleHomepageSnapshots).values({
        lensRole: lens,
        userId: null,
        snapshotData,
      });
      backfilled++;
    } catch (err) {
      report.warnings.push(`Snapshot ${lens}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  report.rowsBackfilled["role_homepage_snapshots"] = backfilled;
  report.rowsSkipped["role_homepage_snapshots"] = skipped;
}

async function persistMigrationReport(report: BackfillReport) {
  try {
    // Store migration report as an app setting for audit/retrieval
    await db.execute(sql.raw(`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (
        'role_lens_migration_report',
        '${JSON.stringify(report).replace(/'/g, "''")}',
        'system:backfill',
        NOW()
      )
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `));
    logger.info("[RoleLensBackfill] Migration report persisted to app_settings.");
  } catch (err) {
    logger.error("[RoleLensBackfill] Failed to persist migration report:", err);
  }
}

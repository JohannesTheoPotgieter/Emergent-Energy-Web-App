/**
 * Backfill script: Collapse 7 override tables into their base tables.
 *
 * For each override row:
 *   1. Find matching base row(s) using the composite key
 *   2. Snapshot the base row's current values into import_snapshot JSONB
 *   3. Apply the override's field values onto the base row
 *   4. Set source = 'imported_edited', last_edited_by, last_edited_at
 *   5. Log orphans (0 matches) and ambiguous (2+ matches)
 *
 * Usage:
 *   npx tsx scripts/backfill-collapse-overrides.ts
 *
 * Prerequisites:
 *   - Run migrations/20260330_collapse_override_tables.sql first
 *   - DATABASE_URL must be set in environment
 *
 * This script is idempotent — re-running will not corrupt data because
 * it checks if import_snapshot is already set before overwriting.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";

interface BackfillResult {
  tableName: string;
  total: number;
  resolved: number;
  orphaned: number;
  ambiguous: number;
  alreadyMigrated: number;
}

const results: BackfillResult[] = [];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log("=== Backfill: Collapse Override Tables Into Base Tables ===\n");

  // 1. expenditure_overrides → program_expense
  await backfillExpenditureOverrides(db);

  // 2. revenue_tracking_overrides → program_inflows
  await backfillRevenueTrackingOverrides(db);

  // 3. cashflow_planning_overrides → cashflow_points
  await backfillCashflowPlanningOverrides(db);

  // 4. cos_status_overrides → program_expense
  await backfillCosStatusOverrides(db);

  // 5. finance_revenue_overrides → finance_revenue_monthly
  await backfillFinanceRevenueOverrides(db);

  // 6. finance_cos_overrides → finance_cos_monthly
  await backfillFinanceCosOverrides(db);

  // 7. project_plan_overrides → project_plan
  await backfillProjectPlanOverrides(db);

  // Print summary
  console.log("\n=== SUMMARY ===\n");
  console.log("Override Table                   | Total | Resolved | Orphaned | Ambiguous | Already Done");
  console.log("-".repeat(95));
  for (const r of results) {
    console.log(
      `${r.tableName.padEnd(33)}| ${String(r.total).padStart(5)} | ${String(r.resolved).padStart(8)} | ${String(r.orphaned).padStart(8)} | ${String(r.ambiguous).padStart(9)} | ${String(r.alreadyMigrated).padStart(12)}`
    );
  }

  const totalOrphaned = results.reduce((s, r) => s + r.orphaned, 0);
  const totalAmbiguous = results.reduce((s, r) => s + r.ambiguous, 0);
  if (totalOrphaned > 0 || totalAmbiguous > 0) {
    console.log(`\nWARNING: ${totalOrphaned} orphaned + ${totalAmbiguous} ambiguous overrides could not be resolved.`);
    console.log("Check override_migration_orphans and override_migration_ambiguous tables for details.");
  } else {
    console.log("\nAll overrides resolved successfully.");
  }

  console.log("\n=== Backfill complete. ===");
  await pool.end();
}

// ─────────────────────────────────────────────────────────────
// 1. expenditure_overrides → program_expense
//    Key: projectName + rowNumber (field-level overrides)
// ─────────────────────────────────────────────────────────────
async function backfillExpenditureOverrides(db: any) {
  console.log("1. Backfilling expenditure_overrides → program_expense...");
  const overrides = await db.execute(sql`
    SELECT * FROM expenditure_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  // Group overrides by (projectName, rowNumber) since they are field-level
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.project_name}::${row.row_number}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  for (const [key, overrideRows] of grouped) {
    const [projectName, rowNumber] = key.split("::");
    const baseRows = await db.execute(sql`
      SELECT id, * FROM program_expense
      WHERE project_name = ${projectName} AND row_number = ${parseInt(rowNumber)}
    `);
    const bases = baseRows.rows as any[];

    if (bases.length === 0) {
      orphaned += overrideRows.length;
      for (const ov of overrideRows) {
        await db.execute(sql`
          INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
          VALUES ('expenditure_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
        `);
      }
      continue;
    }
    if (bases.length > 1) {
      ambiguous += overrideRows.length;
      const baseIds = bases.map((b: any) => b.id);
      for (const ov of overrideRows) {
        await db.execute(sql`
          INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
          VALUES ('expenditure_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
        `);
      }
      continue;
    }

    const base = bases[0];
    if (base.import_snapshot != null) {
      alreadyMigrated += overrideRows.length;
      continue;
    }

    // Snapshot current base row values (exclude id, created_at)
    const { id: _id, created_at: _ca, source: _src, import_snapshot: _is, last_edited_by: _leb, last_edited_at: _lea, ...snapshot } = base;

    // Build SET clause from field-level overrides
    const updates: Record<string, string> = {};
    let latestEditor: number | null = null;
    let latestEditAt: string | null = null;
    for (const ov of overrideRows) {
      // field_name is the camelCase column name; convert to snake_case for SQL
      const snakeField = camelToSnake(ov.field_name);
      updates[snakeField] = ov.override_value;
      if (ov.created_by) latestEditor = ov.created_by;
      if (!latestEditAt || ov.updated_at > latestEditAt) latestEditAt = ov.updated_at;
    }

    // Apply all field overrides to the base row
    const setClauses = Object.entries(updates)
      .map(([col, val]) => `${col} = ${val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`}`)
      .join(", ");

    await db.execute(sql.raw(`
      UPDATE program_expense
      SET ${setClauses},
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_by = ${latestEditor || 'NULL'},
          last_edited_at = ${latestEditAt ? `'${latestEditAt}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved += overrideRows.length;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "expenditure_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// 2. revenue_tracking_overrides → program_inflows
//    Key: projectName + rowNumber (field-level overrides)
// ─────────────────────────────────────────────────────────────
async function backfillRevenueTrackingOverrides(db: any) {
  console.log("2. Backfilling revenue_tracking_overrides → program_inflows...");
  const overrides = await db.execute(sql`
    SELECT * FROM revenue_tracking_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.project_name}::${row.row_number}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  for (const [key, overrideRows] of grouped) {
    const [projectName, rowNumber] = key.split("::");
    const baseRows = await db.execute(sql`
      SELECT id, * FROM program_inflows
      WHERE project_name = ${projectName} AND row_number = ${parseInt(rowNumber)}
    `);
    const bases = baseRows.rows as any[];

    if (bases.length === 0) {
      orphaned += overrideRows.length;
      for (const ov of overrideRows) {
        await db.execute(sql`
          INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
          VALUES ('revenue_tracking_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
        `);
      }
      continue;
    }
    if (bases.length > 1) {
      ambiguous += overrideRows.length;
      const baseIds = bases.map((b: any) => b.id);
      for (const ov of overrideRows) {
        await db.execute(sql`
          INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
          VALUES ('revenue_tracking_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
        `);
      }
      continue;
    }

    const base = bases[0];
    if (base.import_snapshot != null) { alreadyMigrated += overrideRows.length; continue; }

    const { id: _id, created_at: _ca, source: _src, import_snapshot: _is, last_edited_by: _leb, last_edited_at: _lea, ...snapshot } = base;

    const updates: Record<string, string> = {};
    let latestEditor: number | null = null;
    let latestEditAt: string | null = null;
    for (const ov of overrideRows) {
      const snakeField = camelToSnake(ov.field_name);
      updates[snakeField] = ov.override_value;
      if (ov.created_by) latestEditor = ov.created_by;
      if (!latestEditAt || ov.updated_at > latestEditAt) latestEditAt = ov.updated_at;
    }

    const setClauses = Object.entries(updates)
      .map(([col, val]) => `${col} = ${val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`}`)
      .join(", ");

    await db.execute(sql.raw(`
      UPDATE program_inflows
      SET ${setClauses},
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_by = ${latestEditor || 'NULL'},
          last_edited_at = ${latestEditAt ? `'${latestEditAt}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved += overrideRows.length;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "revenue_tracking_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// 3. cashflow_planning_overrides → cashflow_points
//    Key: projectName + weekStartDate (as pointDate) + seriesName
//    Override stores a replacement value (not field-level)
// ─────────────────────────────────────────────────────────────
async function backfillCashflowPlanningOverrides(db: any) {
  console.log("3. Backfilling cashflow_planning_overrides → cashflow_points...");
  const overrides = await db.execute(sql`
    SELECT * FROM cashflow_planning_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  for (const ov of rows) {
    const baseRows = await db.execute(sql`
      SELECT id, * FROM cashflow_points
      WHERE project_name = ${ov.project_name}
        AND point_date = ${ov.week_start_date}
        AND series_name = ${ov.series_name}
    `);
    const bases = baseRows.rows as any[];

    if (bases.length === 0) {
      orphaned++;
      await db.execute(sql`
        INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
        VALUES ('cashflow_planning_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
      `);
      continue;
    }
    if (bases.length > 1) {
      ambiguous++;
      const baseIds = bases.map((b: any) => b.id);
      await db.execute(sql`
        INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
        VALUES ('cashflow_planning_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
      `);
      continue;
    }

    const base = bases[0];
    if (base.import_snapshot != null) { alreadyMigrated++; continue; }

    const snapshot = { value: base.value };

    await db.execute(sql.raw(`
      UPDATE cashflow_points
      SET value = ${ov.override_value === null ? 'NULL' : `'${ov.override_value}'`},
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_by = ${ov.created_by || 'NULL'},
          last_edited_at = ${ov.updated_at ? `'${ov.updated_at.toISOString ? ov.updated_at.toISOString() : ov.updated_at}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved++;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "cashflow_planning_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// 4. cos_status_overrides → program_expense
//    Key: expenseId (direct FK) or projectName + rowNumber
//    Overrides line_status (from originalStatus → overrideStatus)
// ─────────────────────────────────────────────────────────────
async function backfillCosStatusOverrides(db: any) {
  console.log("4. Backfilling cos_status_overrides → program_expense...");
  const overrides = await db.execute(sql`
    SELECT * FROM cos_status_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  for (const ov of rows) {
    // Try expenseId first, then fall back to projectName + rowNumber
    let bases: any[];
    if (ov.expense_id) {
      const result = await db.execute(sql`
        SELECT id, * FROM program_expense WHERE id = ${ov.expense_id}
      `);
      bases = result.rows;
    } else {
      const result = await db.execute(sql`
        SELECT id, * FROM program_expense
        WHERE project_name = ${ov.project_name} AND row_number = ${ov.row_number}
      `);
      bases = result.rows;
    }

    if (bases.length === 0) {
      orphaned++;
      await db.execute(sql`
        INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
        VALUES ('cos_status_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
      `);
      continue;
    }
    if (bases.length > 1 && !ov.expense_id) {
      ambiguous++;
      const baseIds = bases.map((b: any) => b.id);
      await db.execute(sql`
        INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
        VALUES ('cos_status_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
      `);
      continue;
    }

    const base = bases[0];
    // For COS status, only skip if this specific status override already applied
    // (import_snapshot may already be set from expenditure_overrides)
    const existingSnapshot = base.import_snapshot ? (typeof base.import_snapshot === 'string' ? JSON.parse(base.import_snapshot) : base.import_snapshot) : {};
    if (existingSnapshot._cos_status_migrated) { alreadyMigrated++; continue; }

    // Store original line_status in snapshot (merge with existing snapshot if present)
    const snapshot = { ...existingSnapshot, line_status: base.line_status, _cos_status_migrated: true };

    await db.execute(sql.raw(`
      UPDATE program_expense
      SET line_status = '${String(ov.override_status).replace(/'/g, "''")}',
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_at = ${ov.updated_at ? `'${ov.updated_at.toISOString ? ov.updated_at.toISOString() : ov.updated_at}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved++;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "cos_status_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// 5. finance_revenue_overrides → finance_revenue_monthly
//    Key: projectName + category + monthEndDate
//    Overrides the value column
// ─────────────────────────────────────────────────────────────
async function backfillFinanceRevenueOverrides(db: any) {
  console.log("5. Backfilling finance_revenue_overrides → finance_revenue_monthly...");
  const overrides = await db.execute(sql`
    SELECT * FROM finance_revenue_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  for (const ov of rows) {
    const baseRows = await db.execute(sql`
      SELECT id, * FROM finance_revenue_monthly
      WHERE project_name = ${ov.project_name}
        AND category = ${ov.category}
        AND month_end_date = ${ov.month_end_date}
    `);
    const bases = baseRows.rows as any[];

    if (bases.length === 0) {
      orphaned++;
      await db.execute(sql`
        INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
        VALUES ('finance_revenue_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
      `);
      continue;
    }
    if (bases.length > 1) {
      ambiguous++;
      const baseIds = bases.map((b: any) => b.id);
      await db.execute(sql`
        INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
        VALUES ('finance_revenue_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
      `);
      continue;
    }

    const base = bases[0];
    if (base.import_snapshot != null) { alreadyMigrated++; continue; }

    const snapshot = { value: base.value };

    await db.execute(sql.raw(`
      UPDATE finance_revenue_monthly
      SET value = ${ov.override_value === null ? 'NULL' : `'${ov.override_value}'`},
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_by = ${ov.created_by || 'NULL'},
          last_edited_at = ${ov.updated_at ? `'${ov.updated_at.toISOString ? ov.updated_at.toISOString() : ov.updated_at}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved++;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "finance_revenue_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// 6. finance_cos_overrides → finance_cos_monthly
//    Key: projectName + category + monthEndDate
//    Overrides the value column
// ─────────────────────────────────────────────────────────────
async function backfillFinanceCosOverrides(db: any) {
  console.log("6. Backfilling finance_cos_overrides → finance_cos_monthly...");
  const overrides = await db.execute(sql`
    SELECT * FROM finance_cos_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  for (const ov of rows) {
    const baseRows = await db.execute(sql`
      SELECT id, * FROM finance_cos_monthly
      WHERE project_name = ${ov.project_name}
        AND category = ${ov.category}
        AND month_end_date = ${ov.month_end_date}
    `);
    const bases = baseRows.rows as any[];

    if (bases.length === 0) {
      orphaned++;
      await db.execute(sql`
        INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
        VALUES ('finance_cos_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
      `);
      continue;
    }
    if (bases.length > 1) {
      ambiguous++;
      const baseIds = bases.map((b: any) => b.id);
      await db.execute(sql`
        INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
        VALUES ('finance_cos_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
      `);
      continue;
    }

    const base = bases[0];
    if (base.import_snapshot != null) { alreadyMigrated++; continue; }

    const snapshot = { value: base.value };

    await db.execute(sql.raw(`
      UPDATE finance_cos_monthly
      SET value = ${ov.override_value === null ? 'NULL' : `'${ov.override_value}'`},
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_by = ${ov.created_by || 'NULL'},
          last_edited_at = ${ov.updated_at ? `'${ov.updated_at.toISOString ? ov.updated_at.toISOString() : ov.updated_at}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved++;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "finance_cos_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// 7. project_plan_overrides → project_plan
//    Key: projectName + rowNumber (field-level overrides)
// ─────────────────────────────────────────────────────────────
async function backfillProjectPlanOverrides(db: any) {
  console.log("7. Backfilling project_plan_overrides → project_plan...");
  const overrides = await db.execute(sql`
    SELECT * FROM project_plan_overrides ORDER BY id
  `);
  const rows = overrides.rows as any[];
  let resolved = 0, orphaned = 0, ambiguous = 0, alreadyMigrated = 0;

  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.project_name}::${row.row_number}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  for (const [key, overrideRows] of grouped) {
    const [projectName, rowNumber] = key.split("::");
    const baseRows = await db.execute(sql`
      SELECT id, * FROM project_plan
      WHERE project_name = ${projectName} AND row_number = ${parseInt(rowNumber)}
    `);
    const bases = baseRows.rows as any[];

    if (bases.length === 0) {
      orphaned += overrideRows.length;
      for (const ov of overrideRows) {
        await db.execute(sql`
          INSERT INTO override_migration_orphans (override_table, override_id, override_data, reason)
          VALUES ('project_plan_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, 'no_matching_base_row')
        `);
      }
      continue;
    }
    if (bases.length > 1) {
      ambiguous += overrideRows.length;
      const baseIds = bases.map((b: any) => b.id);
      for (const ov of overrideRows) {
        await db.execute(sql`
          INSERT INTO override_migration_ambiguous (override_table, override_id, override_data, matching_base_ids, reason)
          VALUES ('project_plan_overrides', ${ov.id}, ${JSON.stringify(ov)}::jsonb, ${JSON.stringify(baseIds)}::jsonb, 'multiple_matching_base_rows')
        `);
      }
      continue;
    }

    const base = bases[0];
    if (base.import_snapshot != null) { alreadyMigrated += overrideRows.length; continue; }

    const { id: _id, created_at: _ca, source: _src, import_snapshot: _is, last_edited_by: _leb, last_edited_at: _lea, ...snapshot } = base;

    const updates: Record<string, string> = {};
    let latestEditor: number | null = null;
    let latestEditAt: string | null = null;
    for (const ov of overrideRows) {
      const snakeField = camelToSnake(ov.field_name);
      updates[snakeField] = ov.override_value;
      if (ov.created_by) latestEditor = ov.created_by;
      if (!latestEditAt || ov.updated_at > latestEditAt) latestEditAt = ov.updated_at;
    }

    const setClauses = Object.entries(updates)
      .map(([col, val]) => `${col} = ${val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`}`)
      .join(", ");

    await db.execute(sql.raw(`
      UPDATE project_plan
      SET ${setClauses},
          source = 'imported_edited',
          import_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb,
          last_edited_by = ${latestEditor || 'NULL'},
          last_edited_at = ${latestEditAt ? `'${latestEditAt}'` : 'NULL'}
      WHERE id = ${base.id}
    `));
    resolved += overrideRows.length;
  }

  console.log(`   Done: ${resolved} resolved, ${orphaned} orphaned, ${ambiguous} ambiguous, ${alreadyMigrated} already done\n`);
  results.push({ tableName: "project_plan_overrides", total: rows.length, resolved, orphaned, ambiguous, alreadyMigrated });
}

// ─────────────────────────────────────────────────────────────
// Utility: camelCase → snake_case
// ─────────────────────────────────────────────────────────────
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

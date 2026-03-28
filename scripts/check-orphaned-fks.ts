import pg from 'pg';

const checks = [
  {
    name: 'project_info.pm_user_id -> users.id',
    sql: `
      SELECT COUNT(*)::int AS orphan_count
      FROM project_info p
      LEFT JOIN users u ON u.id = p.pm_user_id
      WHERE p.pm_user_id IS NOT NULL AND u.id IS NULL;
    `,
  },
  {
    name: 'project_info.pd_user_id -> users.id',
    sql: `
      SELECT COUNT(*)::int AS orphan_count
      FROM project_info p
      LEFT JOIN users u ON u.id = p.pd_user_id
      WHERE p.pd_user_id IS NOT NULL AND u.id IS NULL;
    `,
  },
  {
    name: 'program_expense.import_run_id -> smart_import_runs.id',
    sql: `
      SELECT COUNT(*)::int AS orphan_count
      FROM program_expense e
      LEFT JOIN smart_import_runs r ON r.id = e.import_run_id
      WHERE e.import_run_id IS NOT NULL AND r.id IS NULL;
    `,
  },
  {
    name: 'program_inflows.import_run_id -> smart_import_runs.id',
    sql: `
      SELECT COUNT(*)::int AS orphan_count
      FROM program_inflows i
      LEFT JOIN smart_import_runs r ON r.id = i.import_run_id
      WHERE i.import_run_id IS NOT NULL AND r.id IS NULL;
    `,
  },
  {
    name: 'project_plan_dependency.predecessor_task_id -> project_plan.id',
    sql: `
      SELECT COUNT(*)::int AS orphan_count
      FROM project_plan_dependency d
      LEFT JOIN project_plan p ON p.id = d.predecessor_task_id
      WHERE p.id IS NULL;
    `,
  },
  {
    name: 'project_plan_dependency.successor_task_id -> project_plan.id',
    sql: `
      SELECT COUNT(*)::int AS orphan_count
      FROM project_plan_dependency d
      LEFT JOIN project_plan p ON p.id = d.successor_task_id
      WHERE p.id IS NULL;
    `,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let hasOrphans = false;
  for (const check of checks) {
    const result = await client.query(check.sql);
    const orphanCount = Number(result.rows[0]?.orphan_count ?? 0);
    const status = orphanCount === 0 ? 'OK' : 'ORPHANS';
    if (orphanCount > 0) hasOrphans = true;
    console.log(`[${status}] ${check.name}: ${orphanCount}`);
  }

  await client.end();

  if (hasOrphans) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Failed to run orphan FK checks', error);
  process.exit(1);
});

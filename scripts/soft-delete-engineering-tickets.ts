import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const ALSO_DETACH_WORK_ITEMS = process.argv.includes('--detach-work-items');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: targets } = await client.query<{
      id: number;
      status: string | null;
      request_type: string | null;
      project_site_name: string | null;
      created_by: number | null;
      created_at: string;
    }>(`
      SELECT id, status, request_type, project_site_name, created_by, created_at
      FROM engineering_tickets
      WHERE deleted_at IS NULL
      ORDER BY id
    `);

    console.log(`Found ${targets.length} live engineering_tickets:`);
    for (const t of targets) {
      console.log(
        `  #${t.id}  [${t.status ?? '-'}]  ${t.request_type ?? '-'}  ${t.project_site_name ?? '-'}  by=${t.created_by ?? 'NULL'}  at=${t.created_at}`,
      );
    }

    const { rows: wiCountRows } = await client.query<{ n: string }>(`
      SELECT COUNT(*)::text AS n
      FROM work_items
      WHERE deleted_at IS NULL
        AND engineering_ticket_id IN (
          SELECT id FROM engineering_tickets WHERE deleted_at IS NULL
        )
    `);
    const linkedWorkItems = Number(wiCountRows[0]?.n ?? '0');
    console.log(`Linked live work_items: ${linkedWorkItems}`);

    if (!APPLY) {
      console.log('\nDRY RUN — no changes written.');
      console.log('Re-run with --apply to soft-delete the tickets above.');
      console.log('Add --detach-work-items to also NULL their work_items.engineering_ticket_id.');
      return;
    }

    await client.query('BEGIN');

    const upd = await client.query(`
      UPDATE engineering_tickets
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE deleted_at IS NULL
      RETURNING id
    `);
    console.log(`Soft-deleted ${upd.rowCount} engineering_tickets.`);

    if (ALSO_DETACH_WORK_ITEMS && linkedWorkItems > 0) {
      const det = await client.query(`
        UPDATE work_items
        SET engineering_ticket_id = NULL, updated_at = NOW()
        WHERE engineering_ticket_id IS NOT NULL
      `);
      console.log(`Detached ${det.rowCount} work_items from tickets.`);
    }

    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();

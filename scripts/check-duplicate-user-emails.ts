import pg from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const query = `
    SELECT lower(email) AS normalized_email,
           count(*)::int AS duplicate_count,
           array_agg(id ORDER BY created_at DESC) AS user_ids
    FROM users
    GROUP BY lower(email)
    HAVING count(*) > 1
    ORDER BY duplicate_count DESC, normalized_email ASC;
  `;

  const { rows } = await client.query(query);

  if (!rows.length) {
    console.log('No duplicate user emails found.');
    await client.end();
    return;
  }

  console.log('Duplicate user emails found:');
  for (const row of rows) {
    console.log(`- ${row.normalized_email}: ${row.duplicate_count} users (ids: ${row.user_ids.join(', ')})`);
  }

  await client.end();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('Failed to check duplicate emails', error);
  process.exit(1);
});

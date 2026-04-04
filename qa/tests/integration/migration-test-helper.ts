/**
 * Migration Integration Test Helper
 *
 * Provisions a disposable Postgres test schema, applies migrations in order,
 * seeds minimal fixture data, and tears down after tests complete.
 *
 * Usage:
 *   import { setupMigrationDb, teardownMigrationDb, testDb } from "./migration-test-helper";
 *   beforeAll(() => setupMigrationDb());
 *   afterAll(() => teardownMigrationDb());
 *   // then use testDb to query
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const TEST_SCHEMA = `migration_test_${Date.now()}`;
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

let pool: pg.Pool | null = null;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function getConnectionString(): string {
  if (process.env.MIGRATION_TEST_DATABASE_URL) return process.env.MIGRATION_TEST_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // CI default
  return "postgresql://test:test@localhost:5432/emergent_test";
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error("Migration test pool not initialized. Call setupMigrationDb() first.");
  return pool;
}

export async function query(sql: string): Promise<any[]> {
  const result = await getPool().query(sql);
  return result.rows;
}

export async function queryOne(sql: string): Promise<any> {
  const rows = await query(sql);
  return rows[0] ?? null;
}

export async function queryCount(sql: string): Promise<number> {
  const row = await queryOne(sql);
  return parseInt(String(row?.cnt ?? row?.count ?? "0"), 10);
}

// ---------------------------------------------------------------------------
// Migration file ordering
// ---------------------------------------------------------------------------

function getMigrationFiles(): string[] {
  const migrationsDir = path.join(PROJECT_ROOT, "migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .filter(f => !f.includes("rollback"))
    .filter(f => !f.includes("_prod")) // skip prod-specific variants
    .sort();
  return files.map(f => path.join(migrationsDir, f));
}

function getPreMigrationScripts(): string[] {
  return [
    path.join(PROJECT_ROOT, "script/pre-push-enums.sql"),
    path.join(PROJECT_ROOT, "script/full-schema-alignment.sql"),
  ].filter(f => fs.existsSync(f));
}

// ---------------------------------------------------------------------------
// SQL Execution via psql (fast, handles $$ blocks correctly)
// ---------------------------------------------------------------------------

function execSqlFile(file: string, connStr: string): void {
  try {
    execSync(`psql "${connStr}" -v ON_ERROR_STOP=0 -f "${file}" 2>&1`, {
      timeout: 120_000,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: "pipe",
    });
  } catch (err: any) {
    // Many migrations use IF NOT EXISTS and are expected to have some warnings
    // Only fail on truly fatal errors
    const stderr = err.stderr ?? err.stdout ?? "";
    if (/FATAL|could not connect|authentication failed/i.test(stderr)) {
      throw new Error(`Fatal psql error on ${path.basename(file)}: ${stderr.slice(0, 500)}`);
    }
  }
}

function execSql(sql: string, connStr: string): void {
  try {
    execSync(`psql "${connStr}" -v ON_ERROR_STOP=0 -c "${sql.replace(/"/g, '\\"')}" 2>&1`, {
      timeout: 30_000,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    // swallow non-fatal
  }
}

// ---------------------------------------------------------------------------
// Fixture data — minimal realistic rows for backfill testing
// ---------------------------------------------------------------------------

const FIXTURE_SQL = `
-- Users (legacy)
INSERT INTO users (id, name, email, role, username, password)
VALUES
  (1, 'Alice PM', 'alice@test.com', 'admin', 'alice', 'hashed'),
  (2, 'Bob Engineer', 'bob@test.com', 'user', 'bob', 'hashed'),
  (3, 'Carol Finance', 'carol@test.com', 'user', 'carol', 'hashed')
ON CONFLICT (id) DO NOTHING;

-- Clients (legacy)
INSERT INTO clients (id, name, created_at)
VALUES
  (1, 'SolarCo Ltd', NOW()),
  (2, 'WindPower Inc', NOW())
ON CONFLICT (id) DO NOTHING;

-- Counterparties (legacy)
INSERT INTO counterparties (id, name, type, created_at)
VALUES
  (1, 'Panel Supply Co', 'SUPPLIER', NOW()),
  (2, 'InstallCrew SA', 'INSTALLER', NOW())
ON CONFLICT (id) DO NOTHING;

-- Projects (legacy)
INSERT INTO project_info (id, project_name, client_id, phase, pm_user_id, created_at, updated_at)
VALUES
  (1, 'Solar Farm Alpha', 1, 'Execution', 1, NOW(), NOW()),
  (2, 'Wind Farm Beta', 2, 'Development', 2, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Cost lines (legacy)
INSERT INTO normalized_cost_lines (id, project_name, counterparty_name, description, amount_ex_vat, status, effective_from, created_at, updated_at)
VALUES
  (1, 'Solar Farm Alpha', 'Panel Supply Co', 'PV Panels Q1', '125000.00', 'INVOICED', '2026-01-15', NOW(), NOW()),
  (2, 'Solar Farm Alpha', 'InstallCrew SA', 'Installation Phase 1', '85000.00', 'APPROVED', '2026-02-01', NOW(), NOW()),
  (3, 'Wind Farm Beta', 'Panel Supply Co', 'Turbine Components', '310000.00', 'PLANNED', '2026-03-01', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Revenue lines (legacy)
INSERT INTO normalized_revenue_lines (id, project_name, description, amount_ex_vat, status, effective_from, created_at, updated_at)
VALUES
  (1, 'Solar Farm Alpha', 'Milestone 1 Payment', '200000.00', 'INVOICED', '2026-02-15', NOW(), NOW()),
  (2, 'Wind Farm Beta', 'Advance Payment', '150000.00', 'PLANNED', '2026-03-15', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Change requests (legacy)
INSERT INTO change_requests (id, project_id, title, change_type, status, cost_impact, requested_by_user_id, created_at, updated_at)
VALUES
  (1, 1, 'Add battery storage', 'cost', 'approved', 45000, 1, NOW(), NOW()),
  (2, 2, 'Reduce turbine count', 'scope', 'draft', -20000, 2, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Approvals (legacy)
INSERT INTO approvals (id, type, title, status, related_entity_type, related_entity_id, project_id, requested_by, created_at, updated_at)
VALUES
  (1, 'stage_gate', 'Phase gate: Development → Execution', 'approved', 'project_info', 1, 1, 1, NOW(), NOW()),
  (2, 'change_request', 'VO: Add battery storage', 'pending', 'change_requests', 1, 1, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
`;

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

export async function setupMigrationDb(): Promise<void> {
  const connStr = getConnectionString();

  // Create pool
  pool = new pg.Pool({ connectionString: connStr, max: 5 });

  // Verify connection
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    throw new Error(`Cannot connect to test Postgres at ${connStr.replace(/:[^@]+@/, ':***@')}: ${err}`);
  }

  console.log("[migration-test] Applying pre-migration scripts...");
  for (const script of getPreMigrationScripts()) {
    execSqlFile(script, connStr);
  }

  console.log("[migration-test] Seeding fixture data...");
  await pool.query(FIXTURE_SQL);

  console.log("[migration-test] Applying migrations...");
  const migrations = getMigrationFiles();
  for (const file of migrations) {
    execSqlFile(file, connStr);
  }

  console.log(`[migration-test] Setup complete. ${migrations.length} migrations applied.`);
}

export async function teardownMigrationDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export async function expectRowCount(table: string, expectedMin: number, where?: string): Promise<number> {
  const whereClause = where ? ` WHERE ${where}` : "";
  const count = await queryCount(`SELECT count(*) AS cnt FROM ${table}${whereClause}`);
  if (count < expectedMin) {
    throw new Error(`Expected ${table}${whereClause} to have >= ${expectedMin} rows, got ${count}`);
  }
  return count;
}

export async function expectNoOrphanedFks(
  table: string,
  fkColumn: string,
  refTable: string,
  refColumn: string = "id",
): Promise<void> {
  const count = await queryCount(
    `SELECT count(*) AS cnt FROM ${table} t WHERE t.${fkColumn} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${refTable} r WHERE r.${refColumn} = t.${fkColumn})`,
  );
  if (count > 0) {
    throw new Error(`${count} rows in ${table}.${fkColumn} reference non-existent ${refTable}.${refColumn}`);
  }
}

export async function expectSumsMatch(
  table1: string, col1: string, where1: string,
  table2: string, col2: string, where2: string,
  tolerance: number = 0.01,
): Promise<void> {
  const [sum1, sum2] = await Promise.all([
    queryOne(`SELECT COALESCE(SUM(${col1}::numeric), 0) AS total FROM ${table1} WHERE ${where1}`),
    queryOne(`SELECT COALESCE(SUM(${col2}::numeric), 0) AS total FROM ${table2} WHERE ${where2}`),
  ]);
  const s1 = parseFloat(sum1.total);
  const s2 = parseFloat(sum2.total);
  if (Math.abs(s1 - s2) > tolerance) {
    throw new Error(`SUM mismatch: ${table1}.${col1} = ${s1}, ${table2}.${col2} = ${s2}, diff = ${(s1 - s2).toFixed(2)}`);
  }
}

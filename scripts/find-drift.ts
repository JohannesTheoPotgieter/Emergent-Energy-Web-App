#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
};

type DriftSnapshot = {
  label: string;
  capturedAt: string;
  database: {
    host: string | null;
    database: string | null;
    schema: string;
  };
  schema: {
    tables: string[];
    columns: Array<{
      table: string;
      column: string;
      type: string;
      nullable: boolean;
      default: string | null;
    }>;
    indexes: Array<{
      table: string;
      index: string;
      definition: string;
    }>;
    constraints: Array<{
      table: string;
      constraint: string;
      type: string;
      definition: string;
    }>;
  };
  drizzleMigrations: {
    tableExists: boolean;
    rows: Array<Record<string, unknown>>;
  };
  startupPolicy: {
    nodeEnv: string | null;
    strictRuntime: boolean;
    startupFlags: Record<string, string | null>;
  };
  routeSafetyChecks: Array<{
    route: string;
    file: string;
    hasProdBlockGuard: boolean;
  }>;
};

const ROUTE_SAFETY_EXPECTATIONS: Array<{ route: string; file: string }> = [
  { route: "/api/admin/wipe-all-data", file: "server/invoice-pattern-routes.ts" },
  { route: "/api/procurement-analysis/reset-tags", file: "server/invoice-pattern-routes.ts" },
  { route: "/api/admin/control-center/dangerous/clear-audit-log", file: "server/admin-control-routes.ts" },
  { route: "/api/role-auth/seed", file: "server/role-auth-routes.ts" },
  { route: "/api/ee-info/os/seed", file: "server/ee-info-routes.ts" },
  { route: "/api/ee-info/story/seed-demo", file: "server/ee-info-routes.ts" },
  { route: "/api/ee-info/story/auto-seed", file: "server/ee-info-routes.ts" },
  { route: "/api/standups/seed-default", file: "server/standup-routes.ts" },
  { route: "/api/tasks/seed-identified-items", file: "server/task-management-routes.ts" },
];

function maskDbUrl(url: string | undefined): { host: string | null; database: string | null } {
  if (!url) return { host: null, database: null };
  try {
    const parsed = new URL(url);
    return { host: parsed.host || null, database: parsed.pathname.replace(/^\//, "") || null };
  } catch {
    return { host: null, database: null };
  }
}

async function fetchSnapshot(label: string, connectionString: string): Promise<DriftSnapshot> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const schemaName = "public";
    const { rows: tableRows } = await client.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `,
      [schemaName],
    );

    const { rows: columnRows } = await client.query<ColumnRow>(
      `
        SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `,
      [schemaName],
    );

    const { rows: indexRows } = await client.query<{
      table_name: string;
      index_name: string;
      indexdef: string;
    }>(
      `
        SELECT tablename AS table_name, indexname AS index_name, indexdef
        FROM pg_indexes
        WHERE schemaname = $1
        ORDER BY tablename, indexname
      `,
      [schemaName],
    );

    const { rows: constraintRows } = await client.query<{
      table_name: string;
      constraint_name: string;
      constraint_type: string;
      definition: string;
    }>(
      `
        SELECT
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          pg_get_constraintdef(c.oid) AS definition
        FROM information_schema.table_constraints tc
        JOIN pg_constraint c ON c.conname = tc.constraint_name
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE tc.table_schema = $1
          AND n.nspname = $1
        ORDER BY tc.table_name, tc.constraint_name
      `,
      [schemaName],
    );

    const migrationTableExists = (
      await client.query<{ exists: string | null }>(`SELECT to_regclass('public.__drizzle_migrations') AS exists`)
    ).rows[0]?.exists != null;

    let migrationRows: Array<Record<string, unknown>> = [];
    if (migrationTableExists) {
      const result = await client.query(`SELECT * FROM "__drizzle_migrations" ORDER BY 1`);
      migrationRows = result.rows as Array<Record<string, unknown>>;
    }

    const startupFlags = {
      ENABLE_STARTUP_MAINTENANCE: process.env.ENABLE_STARTUP_MAINTENANCE ?? null,
      ENABLE_STARTUP_SCHEMA_REPAIR: process.env.ENABLE_STARTUP_SCHEMA_REPAIR ?? null,
      ENABLE_STARTUP_DATA_SEED: process.env.ENABLE_STARTUP_DATA_SEED ?? null,
      ENABLE_STARTUP_BACKFILL: process.env.ENABLE_STARTUP_BACKFILL ?? null,
      ENABLE_STARTUP_SESSION_RESET: process.env.ENABLE_STARTUP_SESSION_RESET ?? null,
      ENABLE_STARTUP_USER_SEED: process.env.ENABLE_STARTUP_USER_SEED ?? null,
    };

    const routeSafetyChecks = ROUTE_SAFETY_EXPECTATIONS.map(({ route, file }) => {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      return {
        route,
        file,
        hasProdBlockGuard: source.includes(route) && source.includes("blockInProduction("),
      };
    });

    const dbMeta = maskDbUrl(connectionString);

    return {
      label,
      capturedAt: new Date().toISOString(),
      database: {
        host: dbMeta.host,
        database: dbMeta.database,
        schema: schemaName,
      },
      schema: {
        tables: tableRows.map((row) => row.table_name),
        columns: columnRows.map((row) => ({
          table: row.table_name,
          column: row.column_name,
          type: row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type,
          nullable: row.is_nullable === "YES",
          default: row.column_default,
        })),
        indexes: indexRows.map((row) => ({
          table: row.table_name,
          index: row.index_name,
          definition: row.indexdef,
        })),
        constraints: constraintRows.map((row) => ({
          table: row.table_name,
          constraint: row.constraint_name,
          type: row.constraint_type,
          definition: row.definition,
        })),
      },
      drizzleMigrations: {
        tableExists: migrationTableExists,
        rows: migrationRows,
      },
      startupPolicy: {
        nodeEnv: process.env.NODE_ENV ?? null,
        strictRuntime: process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging",
        startupFlags,
      },
      routeSafetyChecks,
    };
  } finally {
    await client.end();
  }
}

function stableKey(v: unknown): string {
  return JSON.stringify(v, Object.keys(v as Record<string, unknown>).sort());
}

function diffList<T>(lhs: T[], rhs: T[]): { onlyLeft: T[]; onlyRight: T[] } {
  const rhsSet = new Set(rhs.map((v) => stableKey(v)));
  const lhsSet = new Set(lhs.map((v) => stableKey(v)));
  return {
    onlyLeft: lhs.filter((v) => !rhsSet.has(stableKey(v))),
    onlyRight: rhs.filter((v) => !lhsSet.has(stableKey(v))),
  };
}

async function main() {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const baselineUrl = process.env.BASELINE_DATABASE_URL;
  const outputPath = process.env.DRIFT_OUTPUT_PATH || path.resolve(process.cwd(), "drift-report.json");

  const target = await fetchSnapshot("target", targetUrl);

  if (!baselineUrl) {
    fs.writeFileSync(outputPath, JSON.stringify({ target }, null, 2));
    console.log(`[drift] Wrote single-environment snapshot to ${outputPath}`);
    console.log("[drift] Set BASELINE_DATABASE_URL to compute cross-environment drift.");
    return;
  }

  const baseline = await fetchSnapshot("baseline", baselineUrl);
  const tableDiff = diffList(baseline.schema.tables, target.schema.tables);
  const columnDiff = diffList(baseline.schema.columns, target.schema.columns);
  const indexDiff = diffList(baseline.schema.indexes, target.schema.indexes);
  const constraintDiff = diffList(baseline.schema.constraints, target.schema.constraints);
  const migrationDiff = diffList(baseline.drizzleMigrations.rows, target.drizzleMigrations.rows);
  const routeGuardDiff = diffList(baseline.routeSafetyChecks, target.routeSafetyChecks);

  const report = {
    generatedAt: new Date().toISOString(),
    baseline: {
      database: baseline.database,
      drizzleMigrationCount: baseline.drizzleMigrations.rows.length,
    },
    target: {
      database: target.database,
      drizzleMigrationCount: target.drizzleMigrations.rows.length,
    },
    drift: {
      tables: tableDiff,
      columns: columnDiff,
      indexes: indexDiff,
      constraints: constraintDiff,
      drizzleMigrations: migrationDiff,
      routeGuards: routeGuardDiff,
    },
    snapshots: {
      baseline,
      target,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`[drift] Wrote drift report to ${outputPath}`);
}

main().catch((err) => {
  console.error("[drift] Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

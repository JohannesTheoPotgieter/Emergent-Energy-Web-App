/**
 * Schema verification — does the live DB actually contain every table and
 * column that `shared/schema/*.ts` declares?
 *
 * Background. The migration LEDGER (`drizzle.__drizzle_migrations`) can
 * report a migration applied while its DDL never ran: drizzle-kit migrate
 * skips any journal entry whose `when` sits below the single
 * MAX(created_at) watermark, and scripts/drizzle-bootstrap.ts backfills
 * unprobed entries as "presumed applied". That is how
 * 0071_handover_signoff_and_cr_approver was "applied" with every
 * change_requests column missing, and how the 0090–0096 outage shipped.
 * Hash-presence readiness (server/lib/schema-readiness.ts) cannot catch
 * this class — the hash IS present. The only ground truth is the live
 * information_schema, so this module compares it, column by column,
 * against the Drizzle table definitions.
 *
 * Failure model — deliberately asymmetric:
 *   - MISSING tables/columns (declared in shared/schema, absent in the DB)
 *     are drift: the app's queries will 500. They fail verification.
 *   - EXTRA tables/columns (present in the DB, not declared) are reported
 *     for information only. The schema policy is additive-only and real
 *     DBs carry legacy/baseline-era artifacts; failing on extras would put
 *     production into a false maintenance state.
 *
 * This file is intentionally free of any `server/db` import so the
 * standalone `scripts/db-verify-schema.ts` CLI and unit tests can use it
 * without booting the app. The app-facing glue (live-column query + boot
 * gate + cache refresh) lives in
 * `server/bootstrap/schema-verification-runtime.ts`.
 */

import { is, SQL } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as appSchema from "@shared/schema";

export interface ExpectedColumn {
  name: string;
  sqlType: string;
  notNull: boolean;
  /** Rendered SQL default, or null when absent / not expressible as DDL. */
  defaultSql: string | null;
  primary: boolean;
}

export interface ExpectedTable {
  /** PG schema the table lives in ("public" for the default). */
  schema: string;
  name: string;
  columns: ExpectedColumn[];
}

export interface MissingColumn {
  /** Qualified for non-public schemas (e.g. "core.departments"). */
  table: string;
  column: string;
}

export interface LiveColumn {
  schemaName: string;
  tableName: string;
  columnName: string;
}

/** "departments" stays readable; non-public becomes "core.departments". */
export function qualifiedTableName(schema: string, table: string): string {
  return schema === "public" ? table : `${schema}.${table}`;
}

export type SchemaVerificationState = "aligned" | "schema_drift" | "unknown";

export interface SchemaVerification {
  /** True when nothing declared is missing (or verification does not apply). */
  ok: boolean;
  state: SchemaVerificationState;
  mode: "postgres" | "sqlite";
  missingTables: string[];
  missingColumns: MissingColumn[];
  /** Informational only — never fail the app on extras (additive-only policy). */
  extraTables: string[];
  extraColumns: MissingColumn[];
  expectedTableCount: number;
  checkedAt: string;
  /** Set only when verification could not be determined (state "unknown"). */
  error?: string;
}

const dialect = new PgDialect();

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderDefaultSql(column: {
  hasDefault: boolean;
  default: unknown;
}): string | null {
  if (!column.hasDefault || column.default === undefined || column.default === null) {
    return null;
  }
  const value = column.default;
  if (is(value, SQL)) {
    const query = dialect.sqlToQuery(value);
    // A parameterised default cannot be inlined into DDL — skip it.
    return query.params.length === 0 ? query.sql : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  // Arrays / objects (jsonb defaults etc.) have driver-specific literal
  // forms; the dev auto-repair adds the column without the default rather
  // than guessing wrong DDL. Migrations remain the source of full fidelity.
  return null;
}

/**
 * Derive the expected table/column set from the Drizzle schema barrel.
 * Pure metadata extraction — no I/O, no DB connection.
 */
export function deriveExpectedTables(
  schemaModule: Record<string, unknown> = appSchema as Record<string, unknown>,
): ExpectedTable[] {
  const byName = new Map<string, ExpectedTable>();
  for (const exported of Object.values(schemaModule)) {
    if (!is(exported, PgTable)) continue;
    const config = getTableConfig(exported);
    const schema = config.schema ?? "public";
    const key = qualifiedTableName(schema, config.name);
    if (byName.has(key)) continue; // barrel re-export aliases
    byName.set(key, {
      schema,
      name: config.name,
      columns: config.columns.map((column) => ({
        name: column.name,
        sqlType: column.getSQLType(),
        notNull: column.notNull,
        defaultSql: renderDefaultSql(column),
        primary: column.primary,
      })),
    });
  }
  return [...byName.values()].sort((a, b) =>
    qualifiedTableName(a.schema, a.name).localeCompare(qualifiedTableName(b.schema, b.name)),
  );
}

export interface SchemaComparison {
  missingTables: string[];
  missingColumns: MissingColumn[];
  extraTables: string[];
  extraColumns: MissingColumn[];
}

/**
 * Pure comparison — no I/O. `liveColumns` is the contents of
 * information_schema.columns for the public schema (tables AND views — a
 * Drizzle table backed by a compatibility view counts as present).
 */
export function compareSchemas(
  expected: ExpectedTable[],
  liveColumns: LiveColumn[],
): SchemaComparison {
  const liveByTable = new Map<string, Set<string>>();
  for (const row of liveColumns) {
    const key = qualifiedTableName(row.schemaName, row.tableName);
    let columns = liveByTable.get(key);
    if (!columns) {
      columns = new Set<string>();
      liveByTable.set(key, columns);
    }
    columns.add(row.columnName);
  }

  const missingTables: string[] = [];
  const missingColumns: MissingColumn[] = [];
  const extraColumns: MissingColumn[] = [];
  const expectedTableNames = new Set(
    expected.map((t) => qualifiedTableName(t.schema, t.name)),
  );

  for (const table of expected) {
    const key = qualifiedTableName(table.schema, table.name);
    const live = liveByTable.get(key);
    if (!live) {
      missingTables.push(key);
      continue;
    }
    const expectedColumnNames = new Set(table.columns.map((c) => c.name));
    for (const column of table.columns) {
      if (!live.has(column.name)) {
        missingColumns.push({ table: key, column: column.name });
      }
    }
    for (const liveColumn of live) {
      if (!expectedColumnNames.has(liveColumn)) {
        extraColumns.push({ table: key, column: liveColumn });
      }
    }
  }

  const extraTables = [...liveByTable.keys()]
    .filter((name) => !expectedTableNames.has(name))
    .sort();

  return { missingTables, missingColumns, extraTables, extraColumns };
}

/**
 * Plan ADDITIVE repair DDL for the missing artifacts. Used by the DEV boot
 * auto-repair only — production reports a maintenance state instead.
 *
 * Missing column  → ALTER TABLE … ADD COLUMN IF NOT EXISTS with the
 *                   declared type; NOT NULL only when a default could be
 *                   rendered (a bare NOT NULL add fails on populated tables).
 * Missing table   → minimal CREATE TABLE IF NOT EXISTS (columns + primary
 *                   key). FKs / uniques / indexes are intentionally NOT
 *                   recreated here — committed migrations own constraint
 *                   fidelity; this keeps a dev DB queryable.
 */
export function planAdditiveRepair(
  expected: ExpectedTable[],
  comparison: SchemaComparison,
): string[] {
  const statements: string[] = [];
  const expectedByName = new Map(
    expected.map((t) => [qualifiedTableName(t.schema, t.name), t]),
  );
  const ddlName = (table: ExpectedTable): string =>
    table.schema === "public"
      ? quoteIdent(table.name)
      : `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;

  const schemasEnsured = new Set<string>(["public"]);
  for (const tableName of comparison.missingTables) {
    const table = expectedByName.get(tableName);
    if (!table) continue;
    if (!schemasEnsured.has(table.schema)) {
      statements.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(table.schema)}`);
      schemasEnsured.add(table.schema);
    }
    const columnDefs = table.columns.map((column) => {
      let def = `${quoteIdent(column.name)} ${column.sqlType}`;
      if (column.primary) def += " PRIMARY KEY";
      if (column.defaultSql !== null) def += ` DEFAULT ${column.defaultSql}`;
      if (column.notNull && (column.defaultSql !== null || column.primary || column.sqlType === "serial")) {
        def += " NOT NULL";
      }
      return def;
    });
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${ddlName(table)} (\n  ${columnDefs.join(",\n  ")}\n)`,
    );
  }

  for (const missing of comparison.missingColumns) {
    const table = expectedByName.get(missing.table);
    const column = table?.columns.find((c) => c.name === missing.column);
    if (!table || !column) continue;
    let statement =
      `ALTER TABLE ${ddlName(table)} ` +
      `ADD COLUMN IF NOT EXISTS ${quoteIdent(column.name)} ${column.sqlType}`;
    if (column.defaultSql !== null) statement += ` DEFAULT ${column.defaultSql}`;
    if (column.notNull && column.defaultSql !== null) statement += " NOT NULL";
    statements.push(statement);
  }

  return statements;
}

export function buildVerification(
  comparison: SchemaComparison,
  expectedTableCount: number,
  mode: "postgres" | "sqlite" = "postgres",
): SchemaVerification {
  const ok = comparison.missingTables.length === 0 && comparison.missingColumns.length === 0;
  return {
    ok,
    state: ok ? "aligned" : "schema_drift",
    mode,
    missingTables: comparison.missingTables,
    missingColumns: comparison.missingColumns,
    extraTables: comparison.extraTables,
    extraColumns: comparison.extraColumns,
    expectedTableCount,
    checkedAt: new Date().toISOString(),
  };
}

let cached: SchemaVerification | null = null;

export function getCachedSchemaVerification(): SchemaVerification | null {
  return cached;
}

export function setCachedSchemaVerification(verification: SchemaVerification): void {
  cached = verification;
}

/**
 * True ONLY when drift has been positively determined. Unknown /
 * not-yet-checked / errored states fail OPEN (return false) so the
 * verification feature can never itself take the app down.
 */
export function isSchemaDrifted(verification: SchemaVerification | null = cached): boolean {
  return verification?.state === "schema_drift";
}

export function formatDriftSummary(verification: SchemaVerification): string {
  const parts: string[] = [];
  if (verification.missingTables.length > 0) {
    parts.push(`${verification.missingTables.length} missing table(s): ${verification.missingTables.join(", ")}`);
  }
  if (verification.missingColumns.length > 0) {
    const rendered = verification.missingColumns
      .map((c) => `${c.table}.${c.column}`)
      .join(", ");
    parts.push(`${verification.missingColumns.length} missing column(s): ${rendered}`);
  }
  if (parts.length === 0) return "no missing tables or columns";
  return parts.join("; ");
}

export interface EvaluateSchemaVerificationDeps {
  mode: "postgres" | "sqlite";
  /** information_schema.columns rows for the public schema. */
  queryLiveColumns: () => Promise<LiveColumn[]>;
  schemaModule?: Record<string, unknown>;
}

/**
 * Evaluate the live DB against shared/schema and update the module cache.
 * SQLite dev fallbacks are kept current by the additive bootstrap in
 * `server/db.ts` (not by migrations), so verification does not apply and
 * reports aligned. Any failure fails open as state "unknown".
 */
export async function evaluateSchemaVerification(
  deps: EvaluateSchemaVerificationDeps,
): Promise<SchemaVerification> {
  if (deps.mode === "sqlite") {
    const verification: SchemaVerification = {
      ok: true,
      state: "aligned",
      mode: "sqlite",
      missingTables: [],
      missingColumns: [],
      extraTables: [],
      extraColumns: [],
      expectedTableCount: 0,
      checkedAt: new Date().toISOString(),
    };
    setCachedSchemaVerification(verification);
    return verification;
  }

  try {
    const expected = deriveExpectedTables(deps.schemaModule);
    const liveColumns = await deps.queryLiveColumns();
    const verification = buildVerification(compareSchemas(expected, liveColumns), expected.length);
    setCachedSchemaVerification(verification);
    return verification;
  } catch (err) {
    const verification: SchemaVerification = {
      ok: true,
      state: "unknown",
      mode: "postgres",
      missingTables: [],
      missingColumns: [],
      extraTables: [],
      extraColumns: [],
      expectedTableCount: 0,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
    setCachedSchemaVerification(verification);
    return verification;
  }
}

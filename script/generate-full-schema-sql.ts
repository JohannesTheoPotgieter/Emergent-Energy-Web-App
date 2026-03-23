import { sql } from "drizzle-orm";
import { getTableConfig, getViewConfig } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";
import * as fs from "fs";

function pgTypeForColumn(col: any): string {
  const dt = col.dataType;
  const colType = col.columnType;
  
  if (colType === "PgSerial") return "SERIAL";
  if (colType === "PgBigSerial53") return "BIGSERIAL";
  if (colType === "PgSmallSerial") return "SMALLSERIAL";
  if (colType === "PgInteger") return "INTEGER";
  if (colType === "PgBigInt53") return "BIGINT";
  if (colType === "PgSmallInt") return "SMALLINT";
  if (colType === "PgReal") return "REAL";
  if (colType === "PgDoublePrecision") return "DOUBLE PRECISION";
  if (colType === "PgText") {
    if (col.dimensions && col.dimensions > 0) return "TEXT[]";
    return "TEXT";
  }
  if (colType === "PgVarchar") {
    const len = col.length;
    return len ? `VARCHAR(${len})` : "VARCHAR";
  }
  if (colType === "PgBoolean") return "BOOLEAN";
  if (colType === "PgTimestamp") return "TIMESTAMP";
  if (colType === "PgDate") return "DATE";
  if (colType === "PgTime") return "TIME";
  if (colType === "PgJsonb") return "JSONB";
  if (colType === "PgJson") return "JSON";
  if (colType === "PgUUID") return "UUID";
  if (colType === "PgNumeric") {
    if (col.precision && col.scale) return `NUMERIC(${col.precision},${col.scale})`;
    if (col.precision) return `NUMERIC(${col.precision})`;
    return "NUMERIC";
  }
  if (colType === "PgEnumColumn") {
    return col.enumValues ? col.enum?.enumName || "TEXT" : "TEXT";
  }
  
  // Fallback: use dataType  
  if (dt === "string") return "TEXT";
  if (dt === "number") return "INTEGER";
  if (dt === "boolean") return "BOOLEAN";
  if (dt === "date") return "TIMESTAMP";
  if (dt === "json") return "JSONB";
  if (dt === "bigint") return "BIGINT";
  if (dt === "array") return "TEXT[]";
  if (dt === "custom") return "TEXT";
  if (dt === "buffer") return "BYTEA";
  
  return "TEXT";
}

function getDefaultSQL(col: any): string {
  if (!col.hasDefault) return "";
  const def = col.default;
  if (def === null || def === undefined) return " DEFAULT NULL";
  if (typeof def === "boolean") return ` DEFAULT ${def}`;
  if (typeof def === "number") return ` DEFAULT ${def}`;
  if (typeof def === "string") return ` DEFAULT '${def.replace(/'/g, "''")}'`;
  // For SQL defaults (like NOW()), try to get the SQL string
  if (col.defaultFn) return "";  // can't express in DDL easily
  return "";
}

const lines: string[] = [];
lines.push("-- Auto-generated full schema alignment SQL");
lines.push("-- Adds all missing columns to existing tables");
lines.push("DO $$ BEGIN");

// Iterate over all exported tables
for (const [key, value] of Object.entries(schema)) {
  try {
    const config = getTableConfig(value as any);
    if (!config || !config.name || !config.columns) continue;
    
    const tableName = config.name;
    
    for (const col of config.columns) {
      const colName = col.name;
      if (colName === "id") continue; // Skip primary key - already exists in stubs
      
      let pgType: string;
      
      // Handle enum columns specially
      if (col.columnType === "PgEnumColumn") {
        // Get the enum name from the column config
        const enumObj = (col as any).enum;
        if (enumObj && enumObj.enumName) {
          pgType = enumObj.enumName;
        } else {
          pgType = "TEXT";
        }
      } else {
        pgType = pgTypeForColumn(col);
      }
      
      let defaultClause = getDefaultSQL(col);
      
      lines.push(`  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='${colName}') THEN`);
      lines.push(`    ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${pgType}${defaultClause};`);
      lines.push(`  END IF;`);
    }
  } catch (e) {
    // Not a table, skip
  }
}

lines.push("END $$;");

fs.writeFileSync("script/full-schema-alignment.sql", lines.join("\n"));
console.log(`Generated ${lines.length} lines of SQL`);

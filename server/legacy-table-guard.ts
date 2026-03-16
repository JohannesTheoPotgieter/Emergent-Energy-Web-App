import { db } from "./db";
import { sql } from "drizzle-orm";

const tableExistsCache = new Map<string, boolean>();

export async function legacyTableExists(tableName: string): Promise<boolean> {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName)!;
  try {
    const result = await db.execute(sql.raw(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tableName}') as ex`
    ));
    const rows = Array.isArray(result) ? result : (result as any).rows || [];
    const exists = rows[0]?.ex === true;
    tableExistsCache.set(tableName, exists);
    return exists;
  } catch {
    return false;
  }
}

export function isRelationMissingError(err: any): boolean {
  const message = String(err?.message || "");
  return (
    err?.code === '42P01' ||
    message.includes('does not exist') ||
    message.includes('no such table:') ||
    message.includes('no such column:')
  );
}

export async function safeLegacyQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (isRelationMissingError(err)) {
      return fallback;
    }
    throw err;
  }
}

export async function safeLegacyWrite(fn: () => Promise<any>): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    if (isRelationMissingError(err)) {
      return;
    }
    throw err;
  }
}

export function clearTableExistsCache(): void {
  tableExistsCache.clear();
}

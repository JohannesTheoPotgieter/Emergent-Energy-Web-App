/**
 * Company-wide SharePoint roots (HR, Templates, Policies, …).
 *
 * Complement to projectSharepointRoots: this table holds non-project
 * drives/roots so the /documents browser can show both a "Projects" and
 * "Company" surface.
 */

import { asc, eq } from "drizzle-orm";
import { db, getDbMode } from "../db";
import {
  companySharepointRoots,
  type CompanySharepointRoot,
} from "@shared/schema/documents";

type InsertCompanySharepointRoot = typeof companySharepointRoots.$inferInsert;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /42P01|42703|does not exist|no such table/i.test(msg);
}

function sqliteBoolean(value: boolean): boolean | 0 | 1 {
  return getDbMode() === "sqlite" ? (value ? 1 : 0) : value;
}

export async function listActiveCompanyRoots(): Promise<CompanySharepointRoot[]> {
  try {
    return await db
      .select()
      .from(companySharepointRoots)
      .where(eq(companySharepointRoots.active, sqliteBoolean(true) as any))
      .orderBy(asc(companySharepointRoots.sortOrder), asc(companySharepointRoots.displayName));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getCompanyRootByKind(kind: string): Promise<CompanySharepointRoot | null> {
  try {
    const [row] = await db
      .select()
      .from(companySharepointRoots)
      .where(eq(companySharepointRoots.kind, kind))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function getCompanyRootById(id: number): Promise<CompanySharepointRoot | null> {
  try {
    const [row] = await db
      .select()
      .from(companySharepointRoots)
      .where(eq(companySharepointRoots.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function upsertCompanyRoot(input: InsertCompanySharepointRoot): Promise<CompanySharepointRoot> {
  const existing = await getCompanyRootByKind(input.kind);
  if (existing) {
    const [updated] = await db
      .update(companySharepointRoots)
      .set({
        displayName: input.displayName,
        driveId: input.driveId ?? null,
        rootItemId: input.rootItemId ?? null,
        rootPath: input.rootPath,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        active: sqliteBoolean(input.active ?? existing.active) as any,
        updatedAt: new Date(),
      })
      .where(eq(companySharepointRoots.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(companySharepointRoots)
    .values({
      ...input,
      active: sqliteBoolean(input.active ?? true) as any,
    })
    .returning();
  return created;
}

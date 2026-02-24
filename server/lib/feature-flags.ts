import { db } from "../db";
import { eq } from "drizzle-orm";
import { appSettings } from "@shared/schema";

export async function getFeatureFlag(key: string): Promise<boolean> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (rows.length === 0) return false;
  return rows[0].value === "true" || rows[0].value === "1";
}

export async function setFeatureFlag(key: string, value: boolean, updatedBy: string): Promise<void> {
  const existing = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(appSettings).set({ value: value ? "true" : "false", updatedBy, updatedAt: new Date() }).where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value: value ? "true" : "false", updatedBy, updatedAt: new Date() });
  }
}

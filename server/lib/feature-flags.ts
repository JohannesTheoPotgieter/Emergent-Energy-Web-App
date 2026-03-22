import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { appSettings } from "@shared/schema";
import { ROLLOUT_FEATURE_FLAGS, type RolloutFeatureFlagKey } from "@shared/feature-flags";

function parseFlagValue(raw: string | null | undefined): boolean {
  return raw === "true" || raw === "1";
}

function isMissingAppSettingsTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("no such table: app_settings") ||
    message.includes('relation "app_settings" does not exist') ||
    message.includes("app_settings")
  );
}

export async function getFeatureFlag(key: string): Promise<boolean> {
  try {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    if (rows.length === 0) return false;
    return parseFlagValue(rows[0].value);
  } catch (error) {
    if (isMissingAppSettingsTableError(error)) {
      return false;
    }
    throw error;
  }
}

export async function getFeatureFlags(keys: readonly string[]): Promise<Record<string, boolean>> {
  if (!keys.length) return {};
  const result: Record<string, boolean> = {};
  for (const key of keys) result[key] = false;
  try {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, [...keys]));

    for (const row of rows) result[row.key] = parseFlagValue(row.value);
    return result;
  } catch (error) {
    if (isMissingAppSettingsTableError(error)) {
      return result;
    }
    throw error;
  }
}

export async function setFeatureFlag(key: string, value: boolean, updatedBy: string): Promise<void> {
  const existing = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(appSettings).set({ value: value ? "true" : "false", updatedBy, updatedAt: new Date() }).where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value: value ? "true" : "false", updatedBy, updatedAt: new Date() });
  }
}

export async function ensureRolloutFeatureFlags(updatedBy = "system"): Promise<void> {
  try {
    for (const flag of ROLLOUT_FEATURE_FLAGS) {
      const existing = await db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, flag.key)).limit(1);
      if (!existing.length) {
        await db.insert(appSettings).values({
          key: flag.key,
          value: flag.defaultValue ? "true" : "false",
          updatedBy,
          updatedAt: new Date(),
        });
      }
    }
  } catch (error) {
    if (isMissingAppSettingsTableError(error)) {
      return;
    }
    throw error;
  }
}

export async function getRolloutFeatureFlags(): Promise<Record<RolloutFeatureFlagKey, boolean>> {
  const values = await getFeatureFlags(ROLLOUT_FEATURE_FLAGS.map((flag) => flag.key));
  return ROLLOUT_FEATURE_FLAGS.reduce((acc, flag) => {
    acc[flag.key] = values[flag.key] ?? flag.defaultValue;
    return acc;
  }, {} as Record<RolloutFeatureFlagKey, boolean>);
}

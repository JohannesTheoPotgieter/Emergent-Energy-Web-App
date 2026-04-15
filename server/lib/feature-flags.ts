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

/**
 * Prompt 0.4 follow-up: one-shot enablement for flags that were previously
 * seeded as `false` in existing environments and need to flip on during
 * the next deploy. `ensureRolloutFeatureFlags` only inserts when a row
 * is missing, so it never upgrades environments whose rows already hold
 * the stale `false`. This function applies a targeted upgrade for a
 * specific set of flag keys, and records a marker row so repeat runs
 * are idempotent — operators who deliberately disable a flag AFTER the
 * enablement has been marked done are NOT overridden on subsequent
 * startups. If the marker is already present, the function is a no-op.
 *
 * The marker key namespace is `system:flag-enablement:<group-id>` and
 * its value is the ISO timestamp of the first successful run.
 */
export async function applyOneShotFeatureFlagEnablements(
  groupId: string,
  keysToEnable: readonly string[],
  updatedBy = "system",
): Promise<{ applied: boolean; enabled: string[] }> {
  const markerKey = `system:flag-enablement:${groupId}`;
  try {
    const markerRows = await db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(eq(appSettings.key, markerKey))
      .limit(1);
    if (markerRows.length > 0) {
      return { applied: false, enabled: [] };
    }

    const enabled: string[] = [];
    for (const key of keysToEnable) {
      const existing = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(appSettings).values({
          key,
          value: "true",
          updatedBy,
          updatedAt: new Date(),
        });
        enabled.push(key);
      } else if (!parseFlagValue(existing[0].value)) {
        await db
          .update(appSettings)
          .set({ value: "true", updatedBy, updatedAt: new Date() })
          .where(eq(appSettings.key, key));
        enabled.push(key);
      }
    }

    // Record the marker AFTER the writes so a crash mid-way re-runs next boot.
    await db.insert(appSettings).values({
      key: markerKey,
      value: new Date().toISOString(),
      updatedBy,
      updatedAt: new Date(),
    });

    return { applied: true, enabled };
  } catch (error) {
    if (isMissingAppSettingsTableError(error)) {
      return { applied: false, enabled: [] };
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

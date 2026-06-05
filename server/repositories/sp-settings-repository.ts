/**
 * sp_settings repository — read + alert-config writes for the SharePoint
 * scheduler row. The legacy `storage.getSpSettings()` also reads this row;
 * this repo exists so new routes can update the import-alert fields through
 * the repository layer rather than touching the table inline.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { spSettings, type SpSettings } from "@shared/schema";

export async function getSpSettingsRow(): Promise<SpSettings | null> {
  const [row] = await db.select().from(spSettings).limit(1);
  return row ?? null;
}

export interface AlertSettingsPatch {
  alertsEnabled?: boolean;
  alertTeamId?: string | null;
  alertChannelId?: string | null;
  alertSenderUserId?: number | null;
  alertOnFailure?: boolean;
  alertOnReview?: boolean;
}

/**
 * Patch the Teams-alert fields on the (single) sp_settings row. Returns null
 * when the scheduler row doesn't exist yet — alerts are configured alongside
 * the SharePoint scheduler.
 */
export async function updateAlertSettings(patch: AlertSettingsPatch): Promise<SpSettings | null> {
  const existing = await getSpSettingsRow();
  if (!existing) return null;
  const [row] = await db
    .update(spSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(spSettings.id, existing.id))
    .returning();
  return row ?? null;
}

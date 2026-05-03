import { db } from "../db";
import { appScreenSettings } from "@shared/schema";
import type { AppScreenSetting } from "@shared/schema";

export const screenSettingsRepository = {
  async getAll(): Promise<AppScreenSetting[]> {
    return db.select().from(appScreenSettings);
  },

  async upsert(screenId: string, isEnabled: boolean, updatedByUserId?: number | null): Promise<void> {
    await db
      .insert(appScreenSettings)
      .values({ screenId, isEnabled, updatedByUserId: updatedByUserId ?? null })
      .onConflictDoUpdate({
        target: appScreenSettings.screenId,
        set: { isEnabled, updatedAt: new Date(), updatedByUserId: updatedByUserId ?? null },
      });
  },
};

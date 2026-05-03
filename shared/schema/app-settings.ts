/**
 * App-level admin settings — screen visibility overrides.
 *
 * Stores admin-controlled on/off toggles per navigable screen.
 * screenId matches the `id` field of each PAGE_REGISTRY entry.
 * Only rows where isEnabled=false need to be stored; absence means enabled.
 */

import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const appScreenSettings = pgTable("app_screen_settings", {
  screenId: text("screen_id").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedByUserId: integer("updated_by_user_id"),
});

export type AppScreenSetting = typeof appScreenSettings.$inferSelect;
export type InsertAppScreenSetting = typeof appScreenSettings.$inferInsert;

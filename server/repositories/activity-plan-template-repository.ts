// ============================================================
// Activity-Planning link templates repository
//
// CRUD for activity_plan_templates — reusable keyword rules that recreate the
// inflow→task→outflow links on a new project. The link writes themselves go
// through milestoneTrackerRepository; this only persists the templates.
// ============================================================

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { activityPlanTemplates } from "@shared/schema";

/** One keyword rule: a milestone matching milestoneKeywords links to tasks
 *  matching taskKeywords, which link to outflows matching outflowKeywords. */
export interface ActivityTemplateRule {
  label: string;
  milestoneKeywords: string[];
  taskKeywords: string[];
  outflowKeywords: string[];
}

export interface ActivityTemplateRow {
  id: number;
  name: string;
  description: string | null;
  rules: ActivityTemplateRule[];
  createdBy: number | null;
  createdAt: Date;
}

export class ActivityPlanTemplateRepository {
  private get dbInstance(): typeof db {
    return db;
  }

  async list(): Promise<ActivityTemplateRow[]> {
    const rows = await this.dbInstance
      .select()
      .from(activityPlanTemplates)
      .where(isNull(activityPlanTemplates.deletedAt))
      .orderBy(desc(activityPlanTemplates.createdAt));
    const out: ActivityTemplateRow[] = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        name: r.name,
        description: r.description,
        rules: (r.rules as ActivityTemplateRule[]) ?? [],
        createdBy: r.createdBy,
        createdAt: r.createdAt,
      });
    }
    return out;
  }

  async getById(id: number): Promise<ActivityTemplateRow | null> {
    const [r] = await this.dbInstance
      .select()
      .from(activityPlanTemplates)
      .where(and(eq(activityPlanTemplates.id, id), isNull(activityPlanTemplates.deletedAt)))
      .limit(1);
    if (!r) return null;
    return { id: r.id, name: r.name, description: r.description, rules: (r.rules as ActivityTemplateRule[]) ?? [], createdBy: r.createdBy, createdAt: r.createdAt };
  }

  async create(input: { name: string; description?: string | null; rules: ActivityTemplateRule[]; createdBy: number | null }): Promise<ActivityTemplateRow> {
    const [r] = await this.dbInstance
      .insert(activityPlanTemplates)
      .values({ name: input.name, description: input.description ?? null, rules: input.rules, createdBy: input.createdBy })
      .returning();
    return { id: r.id, name: r.name, description: r.description, rules: (r.rules as ActivityTemplateRule[]) ?? [], createdBy: r.createdBy, createdAt: r.createdAt };
  }

  async update(id: number, patch: { name?: string; description?: string | null; rules?: ActivityTemplateRule[] }): Promise<ActivityTemplateRow | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.rules !== undefined) set.rules = patch.rules;
    const [r] = await this.dbInstance
      .update(activityPlanTemplates)
      .set(set)
      .where(and(eq(activityPlanTemplates.id, id), isNull(activityPlanTemplates.deletedAt)))
      .returning();
    if (!r) return null;
    return { id: r.id, name: r.name, description: r.description, rules: (r.rules as ActivityTemplateRule[]) ?? [], createdBy: r.createdBy, createdAt: r.createdAt };
  }

  async softDelete(id: number): Promise<void> {
    await this.dbInstance
      .update(activityPlanTemplates)
      .set({ deletedAt: new Date() })
      .where(eq(activityPlanTemplates.id, id));
  }
}

export const activityPlanTemplateRepository = new ActivityPlanTemplateRepository();

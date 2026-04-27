// Role template runtime service — Task #101.
//
// - Idempotent boot-time seeder that upserts the curated library from
//   shared/permissions/templates.ts into the `role_templates` table.
// - `previewApplyTemplate(role, key)` returns a plain-English diff
//   ("will gain X actions on Y entity, will lose Z…") for the
//   admin UI before any write.
// - `applyTemplate(role, key, actor, reason)` writes the new
//   entityPermissions JSON back to role_permissions, increments the
//   permissionVersion, audit-logs, and invalidates the runtime cache.

import { eq } from "drizzle-orm";
import { db } from "../db";
import { rolePermissions, roleTemplates, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";
import { ROLE_TEMPLATES, findRoleTemplate, type EntityPermissionMap } from "@shared/permissions/templates";
import { invalidateEntityPermCache } from "../permission-middleware";

const ALL_ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

/** Boot-time idempotent seeder. */
export async function seedRoleTemplates(): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const tpl of ROLE_TEMPLATES) {
    const existing = await db
      .select({ id: roleTemplates.id })
      .from(roleTemplates)
      .where(eq(roleTemplates.key, tpl.key))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(roleTemplates).values({
        key: tpl.key,
        name: tpl.name,
        summary: tpl.summary,
        category: tpl.category,
        permissions: tpl.permissions as any,
        sections: tpl.sections as any,
        isSystem: true,
      });
      inserted++;
    } else {
      await db
        .update(roleTemplates)
        .set({
          name: tpl.name,
          summary: tpl.summary,
          category: tpl.category,
          permissions: tpl.permissions as any,
          sections: tpl.sections as any,
          isSystem: true,
          updatedAt: new Date(),
        })
        .where(eq(roleTemplates.key, tpl.key));
      updated++;
    }
  }
  return { inserted, updated };
}

export async function listRoleTemplates() {
  return db.select().from(roleTemplates).orderBy(roleTemplates.category, roleTemplates.name);
}

interface DiffEntry {
  entity: PermissionEntity;
  title: string;
  category: string;
  gained: PermissionAction[];
  lost: PermissionAction[];
}

export interface ApplyDiff {
  role: string;
  templateKey: string;
  templateName: string;
  templateSummary: string;
  entries: DiffEntry[];
  totalsGained: number;
  totalsLost: number;
  /** A single sentence the admin UI shows above the table. */
  englishHeadline: string;
}

function readCurrentPermissions(rolePermsRow: any): EntityPermissionMap {
  if (rolePermsRow?.entityPermissions && typeof rolePermsRow.entityPermissions === "object") {
    return rolePermsRow.entityPermissions as EntityPermissionMap;
  }
  return {};
}

/**
 * Diffs the current role permissions against the template's
 * permissions and returns a per-entity gain/loss summary.
 */
export async function previewApplyTemplate(role: string, templateKey: string): Promise<ApplyDiff> {
  const tpl = findRoleTemplate(templateKey);
  if (!tpl) throw Object.assign(new Error("Unknown template"), { status: 404 });

  const [current] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  const currentPerms = readCurrentPermissions(current);

  const entries: DiffEntry[] = [];
  let totalsGained = 0;
  let totalsLost = 0;

  for (const entity of ENTITY_REGISTRY) {
    const cur = currentPerms[entity.entity] ?? ({} as Record<PermissionAction, boolean>);
    const next = tpl.permissions[entity.entity] ?? ({} as Record<PermissionAction, boolean>);
    const gained: PermissionAction[] = [];
    const lost: PermissionAction[] = [];
    for (const action of ALL_ACTIONS) {
      const before = !!cur[action];
      const after = !!next[action];
      if (before && !after) lost.push(action);
      else if (!before && after) gained.push(action);
    }
    if (gained.length || lost.length) {
      entries.push({
        entity: entity.entity,
        title: entity.title,
        category: entity.category,
        gained,
        lost,
      });
      totalsGained += gained.length;
      totalsLost += lost.length;
    }
  }

  let headline: string;
  if (totalsGained === 0 && totalsLost === 0) {
    headline = `No change — "${role}" already matches the "${tpl.name}" template.`;
  } else {
    const parts: string[] = [];
    if (totalsGained > 0) parts.push(`gain ${totalsGained} action${totalsGained === 1 ? "" : "s"}`);
    if (totalsLost > 0) parts.push(`lose ${totalsLost} action${totalsLost === 1 ? "" : "s"}`);
    headline = `Applying "${tpl.name}" to "${role}" will ${parts.join(" and ")} across ${entries.length} workspace${entries.length === 1 ? "" : "s"}.`;
  }

  return {
    role,
    templateKey,
    templateName: tpl.name,
    templateSummary: tpl.summary,
    entries,
    totalsGained,
    totalsLost,
    englishHeadline: headline,
  };
}

export async function applyTemplate(
  role: string,
  templateKey: string,
  actorUserId: number,
  reason: string,
): Promise<{ ok: true; permissionVersion: number; diff: ApplyDiff }> {
  const tpl = findRoleTemplate(templateKey);
  if (!tpl) throw Object.assign(new Error("Unknown template"), { status: 404 });
  const diff = await previewApplyTemplate(role, templateKey);

  const [current] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);

  const noteLine = `[template:${templateKey}] applied by user#${actorUserId} on ${new Date().toISOString()} — ${reason}`;

  if (!current) {
    await db.insert(rolePermissions).values({
      role,
      label: tpl.name,
      description: tpl.summary,
      sections: tpl.sections as any,
      entityPermissions: tpl.permissions as any,
      canManageUsers: false,
      canManageRoles: false,
      canEditData: true,
      isSystem: false,
      permissionVersion: 1,
      notes: noteLine,
    });
  } else {
    await db
      .update(rolePermissions)
      .set({
        entityPermissions: tpl.permissions as any,
        sections: tpl.sections as any,
        permissionVersion: (current.permissionVersion ?? 1) + 1,
        notes: [current.notes, noteLine].filter(Boolean).join("\n"),
        updatedAt: new Date(),
      })
      .where(eq(rolePermissions.role, role));
  }

  invalidateEntityPermCache();
  const [refreshed] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  return { ok: true, permissionVersion: refreshed?.permissionVersion ?? 1, diff };
}

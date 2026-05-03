// Role template runtime service — Task #101.
//
// Boot-time idempotent seeder, plain-English diff preview, and two
// apply paths:
//   • applyTemplate(role, …)         — mutates role_permissions for a whole role
//   • applyTemplateToUser(userId, …) — writes user_permission_overrides for one user
//
// Both apply paths write a row into permission_audit_log with the actor,
// target, before/after state, and the human reason — that audit trail is
// what the COO/CEO see in the Admin > Audit screen.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  permissionAuditLog,
  rolePermissions,
  roleTemplates,
  userPermissionOverrides,
  users,
  type EntityPermissionsJson,
  type PermissionAction,
  type PermissionEntity,
} from "@shared/schema";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";
import {
  ROLE_TEMPLATES,
  findRoleTemplate,
  type EntityPermissionMap,
} from "@shared/permissions/templates";
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
    const permissions: EntityPermissionsJson = tpl.permissions as EntityPermissionsJson;
    if (existing.length === 0) {
      await db.insert(roleTemplates).values({
        key: tpl.key,
        name: tpl.name,
        summary: tpl.summary,
        category: tpl.category,
        permissions,
        sections: tpl.sections,
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
          permissions,
          sections: tpl.sections,
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
  /** Either a role string OR a user id, depending on `targetKind`. */
  targetKind: "role" | "user";
  targetRole?: string;
  targetUserId?: number;
  templateKey: string;
  templateName: string;
  templateSummary: string;
  entries: DiffEntry[];
  totalsGained: number;
  totalsLost: number;
  /** A single sentence the admin UI shows above the table. */
  englishHeadline: string;
}

function asPermissionMap(value: unknown): EntityPermissionMap {
  if (value && typeof value === "object") {
    return value as EntityPermissionMap;
  }
  return {} as EntityPermissionMap;
}

function diffPermissions(
  current: EntityPermissionMap,
  next: EntityPermissionMap,
): { entries: DiffEntry[]; totalsGained: number; totalsLost: number } {
  const entries: DiffEntry[] = [];
  let totalsGained = 0;
  let totalsLost = 0;
  for (const entity of ENTITY_REGISTRY) {
    const cur = current[entity.entity] ?? ({} as Record<PermissionAction, boolean>);
    const nxt = next[entity.entity] ?? ({} as Record<PermissionAction, boolean>);
    const gained: PermissionAction[] = [];
    const lost: PermissionAction[] = [];
    for (const action of ALL_ACTIONS) {
      const before = !!cur[action];
      const after = !!nxt[action];
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
  return { entries, totalsGained, totalsLost };
}

function makeHeadline(
  targetLabel: string,
  templateName: string,
  totals: { totalsGained: number; totalsLost: number; entryCount: number },
): string {
  if (totals.totalsGained === 0 && totals.totalsLost === 0) {
    return `No change — ${targetLabel} already matches the "${templateName}" template.`;
  }
  const parts: string[] = [];
  if (totals.totalsGained > 0)
    parts.push(`gain ${totals.totalsGained} action${totals.totalsGained === 1 ? "" : "s"}`);
  if (totals.totalsLost > 0)
    parts.push(`lose ${totals.totalsLost} action${totals.totalsLost === 1 ? "" : "s"}`);
  return `Applying "${templateName}" to ${targetLabel} will ${parts.join(" and ")} across ${totals.entryCount} workspace${totals.entryCount === 1 ? "" : "s"}.`;
}

// Role-vs-role comparison for the Roles tab Compare card.

export interface RoleCompareEntry {
  entity: PermissionEntity;
  title: string;
  category: string;
  aOnly: PermissionAction[];
  bOnly: PermissionAction[];
  shared: PermissionAction[];
}

export interface RoleCompareResult {
  roleA: string;
  roleB: string;
  entries: RoleCompareEntry[];
  totalsAOnly: number;
  totalsBOnly: number;
  totalsShared: number;
  englishHeadline: string;
}

export async function compareRoles(
  roleA: string,
  roleB: string,
): Promise<RoleCompareResult> {
  const [a] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleA)).limit(1);
  const [b] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleB)).limit(1);
  const aPerms = asPermissionMap(a?.entityPermissions);
  const bPerms = asPermissionMap(b?.entityPermissions);

  const entries: RoleCompareEntry[] = [];
  let totalsAOnly = 0;
  let totalsBOnly = 0;
  let totalsShared = 0;

  for (const entity of ENTITY_REGISTRY) {
    const ap: Partial<Record<PermissionAction, boolean>> = aPerms[entity.entity] ?? {};
    const bp: Partial<Record<PermissionAction, boolean>> = bPerms[entity.entity] ?? {};
    const aOnly: PermissionAction[] = [];
    const bOnly: PermissionAction[] = [];
    const shared: PermissionAction[] = [];
    for (const action of ALL_ACTIONS) {
      const inA = !!ap[action];
      const inB = !!bp[action];
      if (inA && inB) shared.push(action);
      else if (inA) aOnly.push(action);
      else if (inB) bOnly.push(action);
    }
    if (aOnly.length || bOnly.length || shared.length) {
      entries.push({
        entity: entity.entity,
        title: entity.title,
        category: entity.category,
        aOnly,
        bOnly,
        shared,
      });
      totalsAOnly += aOnly.length;
      totalsBOnly += bOnly.length;
      totalsShared += shared.length;
    }
  }

  let englishHeadline: string;
  if (roleA === roleB) {
    englishHeadline = `"${roleA}" compared to itself — every permission is shared (${totalsShared} action${totalsShared === 1 ? "" : "s"}).`;
  } else if (totalsAOnly === 0 && totalsBOnly === 0) {
    englishHeadline = `"${roleA}" and "${roleB}" have identical permissions across ${entries.length} workspace${entries.length === 1 ? "" : "s"}.`;
  } else {
    const parts: string[] = [];
    if (totalsAOnly > 0) parts.push(`"${roleA}" has ${totalsAOnly} action${totalsAOnly === 1 ? "" : "s"} the other does not`);
    if (totalsBOnly > 0) parts.push(`"${roleB}" has ${totalsBOnly} action${totalsBOnly === 1 ? "" : "s"} the other does not`);
    englishHeadline = `${parts.join("; ")} — they share ${totalsShared} action${totalsShared === 1 ? "" : "s"}.`;
  }

  return { roleA, roleB, entries, totalsAOnly, totalsBOnly, totalsShared, englishHeadline };
}

/** Diffs a role's current permissions against the template. */
export async function previewApplyTemplate(role: string, templateKey: string): Promise<ApplyDiff> {
  const tpl = findRoleTemplate(templateKey);
  if (!tpl) throw Object.assign(new Error("Unknown template"), { status: 404 });

  const [current] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  const currentPerms = asPermissionMap(current?.entityPermissions);
  const nextPerms = tpl.permissions as EntityPermissionMap;

  const { entries, totalsGained, totalsLost } = diffPermissions(currentPerms, nextPerms);
  return {
    targetKind: "role",
    targetRole: role,
    templateKey,
    templateName: tpl.name,
    templateSummary: tpl.summary,
    entries,
    totalsGained,
    totalsLost,
    englishHeadline: makeHeadline(`"${role}"`, tpl.name, {
      totalsGained,
      totalsLost,
      entryCount: entries.length,
    }),
  };
}

/**
 * Build a user's CURRENT effective entity-permission map from
 * (role baseline ∪ active overrides). Used by the user-scoped diff so the
 * preview reflects exactly what the user can do today.
 */
async function getUserEffectivePermissions(userId: number): Promise<{
  role: string;
  perms: EntityPermissionMap;
}> {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  const role = u?.role ?? "";
  const [rp] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  const baseline = asPermissionMap(rp?.entityPermissions);
  const merged: EntityPermissionMap = JSON.parse(JSON.stringify(baseline));

  const overrides = await db
    .select({
      entity: userPermissionOverrides.entity,
      action: userPermissionOverrides.action,
      allowed: userPermissionOverrides.allowed,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));

  for (const o of overrides) {
    const entityKey = o.entity as PermissionEntity;
    const actionKey = o.action as PermissionAction;
    const bucket = (merged[entityKey] ?? {}) as Record<PermissionAction, boolean>;
    bucket[actionKey] = !!o.allowed;
    merged[entityKey] = bucket;
  }
  return { role, perms: merged };
}

/** Diffs a user's current effective permissions against the template. */
export async function previewApplyTemplateToUser(
  userId: number,
  templateKey: string,
): Promise<ApplyDiff & { currentRole: string }> {
  const tpl = findRoleTemplate(templateKey);
  if (!tpl) throw Object.assign(new Error("Unknown template"), { status: 404 });

  const { role, perms } = await getUserEffectivePermissions(userId);
  const nextPerms = tpl.permissions as EntityPermissionMap;
  const { entries, totalsGained, totalsLost } = diffPermissions(perms, nextPerms);

  return {
    targetKind: "user",
    targetUserId: userId,
    currentRole: role,
    templateKey,
    templateName: tpl.name,
    templateSummary: tpl.summary,
    entries,
    totalsGained,
    totalsLost,
    englishHeadline: makeHeadline(`user #${userId}`, tpl.name, {
      totalsGained,
      totalsLost,
      entryCount: entries.length,
    }),
  };
}

export async function applyTemplate(
  role: string,
  templateKey: string,
  actorUserId: number,
  actorRole: string | null,
  reason: string,
): Promise<{ ok: true; permissionVersion: number; diff: ApplyDiff }> {
  const tpl = findRoleTemplate(templateKey);
  if (!tpl) throw Object.assign(new Error("Unknown template"), { status: 404 });
  const diff = await previewApplyTemplate(role, templateKey);

  const [current] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  const beforePerms = asPermissionMap(current?.entityPermissions);
  const nextPerms: EntityPermissionsJson = tpl.permissions as EntityPermissionsJson;

  const noteLine = `[template:${templateKey}] applied by user#${actorUserId} on ${new Date().toISOString()} — ${reason}`;

  if (!current) {
    await db.insert(rolePermissions).values({
      role,
      label: tpl.name,
      description: tpl.summary,
      sections: tpl.sections,
      entityPermissions: nextPerms,
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
        entityPermissions: nextPerms,
        sections: tpl.sections,
        permissionVersion: (current.permissionVersion ?? 1) + 1,
        notes: [current.notes, noteLine].filter(Boolean).join("\n"),
        updatedAt: new Date(),
      })
      .where(eq(rolePermissions.role, role));
  }

  await db.insert(permissionAuditLog).values({
    eventType: "template_applied_to_role",
    targetRole: role,
    changedByUserId: actorUserId || null,
    changedByRole: actorRole,
    changeDetail: {
      templateKey,
      templateName: tpl.name,
      reason,
      before: beforePerms,
      after: nextPerms,
      diff: {
        entries: diff.entries,
        totalsGained: diff.totalsGained,
        totalsLost: diff.totalsLost,
      },
    },
  });

  invalidateEntityPermCache();
  const [refreshed] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  return { ok: true, permissionVersion: refreshed?.permissionVersion ?? 1, diff };
}

/**
 * Apply a template to a SINGLE USER by writing user_permission_overrides
 * for each (entity, action) where the template differs from the user's
 * current role baseline. The user's role itself is never mutated — this
 * is the safety guarantee that distinguishes the People tab from the
 * Roles tab.
 */
export async function applyTemplateToUser(
  userId: number,
  templateKey: string,
  actorUserId: number,
  actorRole: string | null,
  reason: string,
): Promise<{
  ok: true;
  written: number;
  cleared: number;
  diff: ApplyDiff & { currentRole: string };
}> {
  const tpl = findRoleTemplate(templateKey);
  if (!tpl) throw Object.assign(new Error("Unknown template"), { status: 404 });

  const diff = await previewApplyTemplateToUser(userId, templateKey);
  const { role, perms: beforePerms } = await getUserEffectivePermissions(userId);

  const [rp] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  const baseline = asPermissionMap(rp?.entityPermissions);
  const nextPerms = tpl.permissions as EntityPermissionMap;

  const noteLine = `[template:${templateKey}] applied to user#${userId} by user#${actorUserId} on ${new Date().toISOString()} — ${reason}`;

  let written = 0;
  let cleared = 0;

  // For each entity:action the template specifies, write an override iff
  // the template's value diverges from the role baseline. If the template
  // matches the baseline, REMOVE any stale override so the user falls back
  // to the baseline (keeps the override table clean and predictable).
  for (const entity of ENTITY_REGISTRY) {
    const tplBucket = (nextPerms[entity.entity] ?? {}) as Record<PermissionAction, boolean>;
    const baseBucket = (baseline[entity.entity] ?? {}) as Record<PermissionAction, boolean>;
    for (const action of ALL_ACTIONS) {
      const tplVal = !!tplBucket[action];
      const baseVal = !!baseBucket[action];

      if (tplVal === baseVal) {
        // No divergence — drop any pre-existing override row.
        const removed = await db
          .delete(userPermissionOverrides)
          .where(
            and(
              eq(userPermissionOverrides.userId, userId),
              eq(userPermissionOverrides.entity, entity.entity),
              eq(userPermissionOverrides.action, action),
            ),
          )
          .returning({ id: userPermissionOverrides.id });
        cleared += removed.length;
        continue;
      }

      // Divergence — upsert the override row (delete-then-insert keeps it
      // simple given there is no composite unique index in the table).
      await db
        .delete(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, userId),
            eq(userPermissionOverrides.entity, entity.entity),
            eq(userPermissionOverrides.action, action),
          ),
        );
      await db.insert(userPermissionOverrides).values({
        userId,
        entity: entity.entity,
        action,
        allowed: tplVal,
        grantedBy: actorUserId || null,
        reason,
        notes: noteLine,
      });
      written++;
    }
  }

  await db.insert(permissionAuditLog).values({
    eventType: "template_applied_to_user",
    targetUserId: userId,
    targetRole: role || null,
    changedByUserId: actorUserId || null,
    changedByRole: actorRole,
    changeDetail: {
      templateKey,
      templateName: tpl.name,
      reason,
      currentRole: role,
      written,
      cleared,
      before: beforePerms,
      diff: {
        entries: diff.entries,
        totalsGained: diff.totalsGained,
        totalsLost: diff.totalsLost,
      },
    },
  });

  invalidateEntityPermCache();
  return { ok: true, written, cleared, diff };
}

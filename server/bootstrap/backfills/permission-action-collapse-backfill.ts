import { eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  rolePermissions,
  roleTemplates,
  userPermissionOverrides,
} from "@shared/schema";

/**
 * Permission-model collapse (Roles & Permissions → view|edit).
 *
 * The permission matrix used to expose six per-entity actions
 * (view/create/edit/approve/override/delete). It is now a three-state scale:
 * No access / View / Edit, where `edit` subsumes every mutating capability.
 *
 * This backfill rewrites any persisted grants that still use the old action
 * keys so nothing a role/user was previously granted is silently dropped once
 * the resolver stops consulting create/approve/override/delete:
 *
 *   - role_permissions.entity_permissions  (JSON: entity → action → bool)
 *   - role_templates.permissions           (JSON: entity → action → bool)
 *   - user_permission_overrides            (one row per entity/action)
 *
 * The transform is idempotent — re-running on already-collapsed data is a
 * no-op — and only writes rows that actually change.
 */

const MUTATING_KEYS = ["edit", "create", "approve", "override", "delete"] as const;

type ActionRow = Record<string, boolean>;
type EntityPermsJson = Record<string, ActionRow>;

/**
 * Collapse a single entity-permissions JSON blob to the view|edit model.
 * `edit` = OR of any mutating action; `view` = explicit view OR (edit implies
 * view). Meta keys (prefixed with `_`) are preserved verbatim. Pure + exported
 * for unit testing.
 */
export function collapseEntityPermissions(
  ep: EntityPermsJson | null | undefined,
): { collapsed: EntityPermsJson; changed: boolean } {
  const out: EntityPermsJson = {};
  let changed = false;
  if (!ep || typeof ep !== "object") return { collapsed: out, changed: false };

  for (const [entity, actions] of Object.entries(ep)) {
    if (entity.startsWith("_")) {
      out[entity] = actions;
      continue;
    }
    const a = (actions || {}) as ActionRow;
    const edit = MUTATING_KEYS.some((k) => a[k] === true);
    const view = a.view === true || edit;
    out[entity] = { view, edit };

    // Detect whether this entity changed shape or values.
    const keys = Object.keys(a);
    const sameShape = keys.length === 2 && a.view === view && a.edit === edit;
    if (!sameShape) changed = true;
  }

  return { collapsed: out, changed };
}

function collapseAction(action: string): "view" | "edit" {
  return action === "view" ? "view" : "edit";
}

export async function runPermissionActionCollapseBackfill(
  log: (message: string, source?: string) => void,
): Promise<void> {
  const src = "Startup:Backfill";

  // ── 1. role_permissions.entity_permissions ──────────────────────────
  let roleRows = 0;
  const roles = await db
    .select({ role: rolePermissions.role, ep: rolePermissions.entityPermissions })
    .from(rolePermissions);
  for (const r of roles) {
    const { collapsed, changed } = collapseEntityPermissions(r.ep as EntityPermsJson | null);
    if (changed) {
      await db
        .update(rolePermissions)
        .set({ entityPermissions: collapsed })
        .where(eq(rolePermissions.role, r.role));
      roleRows++;
    }
  }

  // ── 2. role_templates.permissions ───────────────────────────────────
  let templateRows = 0;
  const templates = await db
    .select({ key: roleTemplates.key, perms: roleTemplates.permissions })
    .from(roleTemplates);
  for (const t of templates) {
    const { collapsed, changed } = collapseEntityPermissions(t.perms as EntityPermsJson | null);
    if (changed) {
      await db
        .update(roleTemplates)
        .set({ permissions: collapsed })
        .where(eq(roleTemplates.key, t.key));
      templateRows++;
    }
  }

  // ── 3. user_permission_overrides (one row per entity/action) ─────────
  // Collapse granular action rows to `edit`, merging into any existing edit
  // row for the same (user, entity). A grant (allowed=true) wins over a deny.
  let overrideUpdates = 0;
  let overrideDeletes = 0;
  const activeRows = await db
    .select()
    .from(userPermissionOverrides)
    .where(isNull(userPermissionOverrides.deletedAt));

  // (userId|entity) → id of the canonical edit row, as we converge.
  const editRowByGroup = new Map<string, number>();
  for (const row of activeRows) {
    if (row.action === "edit") editRowByGroup.set(`${row.userId}|${row.entity}`, row.id);
  }

  for (const row of activeRows) {
    if (row.action === "view" || row.action === "edit") continue;
    const groupKey = `${row.userId}|${row.entity}`;
    const existingEditId = editRowByGroup.get(groupKey);

    if (existingEditId === undefined) {
      // Promote this row to the canonical edit row for its group.
      await db
        .update(userPermissionOverrides)
        .set({ action: "edit" })
        .where(eq(userPermissionOverrides.id, row.id));
      editRowByGroup.set(groupKey, row.id);
      overrideUpdates++;
    } else {
      // Merge: a grant wins; then remove this now-redundant row.
      if (row.allowed === true) {
        await db
          .update(userPermissionOverrides)
          .set({ allowed: true })
          .where(eq(userPermissionOverrides.id, existingEditId));
      }
      await db
        .delete(userPermissionOverrides)
        .where(eq(userPermissionOverrides.id, row.id));
      overrideDeletes++;
    }
  }

  if (roleRows || templateRows || overrideUpdates || overrideDeletes) {
    log(
      `[Backfill] permission action collapse: roles=${roleRows} templates=${templateRows} ` +
        `overrides(updated=${overrideUpdates}, removed=${overrideDeletes})`,
      src,
    );
  }
}

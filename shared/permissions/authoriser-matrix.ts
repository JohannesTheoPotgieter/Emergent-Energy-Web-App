/**
 * Authoriser matrix — typed `entity → override_roles` map per AGENT_GUARDRAILS.md
 * § 0A (override principle).
 *
 * The canonical source of override authority is `ENTITY_REGISTRY[entity].override_roles`
 * in `shared/permissions/registry.ts`. This file projects that data into a flat,
 * typed lookup so callers that only need the override-roles list don't have to
 * walk the full registry.
 *
 * Plan v3 § 2.4 originally prescribed a standalone matrix file. By the time
 * this work landed, `requireAuthoriserFor` already read directly from the
 * entity registry — so this file is a thin typed view, not a parallel source.
 *
 * Update path: edit `ENTITY_REGISTRY` in `shared/permissions/registry.ts`. This
 * file recomputes from it at module-evaluation time. Do NOT hand-edit the
 * exported `AUTHORISER_MATRIX` constant — it would drift from the registry.
 */

import type { CompanyRole, PermissionEntity } from "../schema/users";
import { ENTITY_REGISTRY } from "./registry";

/**
 * Flat `entity → override_roles` map. Frozen at module load. Future agents
 * looking for "where does the authoriser matrix live" should land here first
 * and follow the registry pointer.
 */
export const AUTHORISER_MATRIX: Readonly<Record<PermissionEntity, readonly CompanyRole[]>> =
  Object.freeze(
    Object.fromEntries(
      ENTITY_REGISTRY.map((entry) => [entry.entity, Object.freeze([...entry.override_roles])]),
    ),
  ) as Readonly<Record<PermissionEntity, readonly CompanyRole[]>>;

/**
 * Returns the override roles for an entity. Throws if the entity is not in the
 * registry — callers should pass a typed `PermissionEntity`, but defence-in-
 * depth catches stringly-typed callers in tests / scripts.
 */
export function getOverrideRolesFor(entity: PermissionEntity): readonly CompanyRole[] {
  const roles = AUTHORISER_MATRIX[entity];
  if (!roles) {
    throw new Error(
      `getOverrideRolesFor: entity '${entity}' not in AUTHORISER_MATRIX. ` +
        `Add it to ENTITY_REGISTRY in shared/permissions/registry.ts.`,
    );
  }
  return roles;
}

/**
 * Type guard: does the given role have override authority on the given entity?
 * Use sparingly — `requireAuthoriserFor(entity)` middleware is the canonical
 * server-side gate; this helper is for client-side affordance checks.
 */
export function canOverride(role: CompanyRole | string, entity: PermissionEntity): boolean {
  const roles = AUTHORISER_MATRIX[entity];
  if (!roles) return false;
  return (roles as readonly string[]).includes(role);
}

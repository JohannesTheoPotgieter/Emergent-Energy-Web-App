/**
 * Unified Permission Middleware — Wave 1 Step 6
 *
 * This is the canonical permission enforcement for all new API contracts.
 * It wraps the existing 3-tier permission system:
 *   1. User overrides (highest priority) — userPermissionOverrides table
 *   2. DB role permissions — rolePermissions.entityPermissions JSONB
 *   3. Code defaults (lowest) — ENTITY_PERMISSION_DEFAULTS
 *
 * New endpoints MUST use these exports instead of ad-hoc role checks.
 *
 * Migration note: The existing requirePermission/requireAuthority in
 * permission-middleware.ts already implements the full 3-tier resolution.
 * This file re-exports them under the Wave 1 naming convention and adds
 * the requireAuth wrapper for consistency.
 */

import { requirePermission, requireAuthority } from "../permission-middleware";
import type { PermissionEntity, PermissionAction } from "@shared/schema";

// Re-export the existing middleware under the canonical Wave 1 name
export { requirePermission as checkPermission };
export { requireAuthority as checkAuthority };

// Re-export types for convenience
export type { PermissionEntity, PermissionAction };

/**
 * Require authentication middleware.
 * Wraps the existing auth-context requireAuth.
 */
export { requireAuth } from "../middleware/requireAuth";

/**
 * Require admin role middleware.
 * Checks for COO_ADMIN or CEO_ADMIN roles.
 */
export { requireAdmin } from "../middleware/requireAdmin";

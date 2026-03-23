/**
 * Workstream Visibility Middleware
 *
 * Provides SQL-level workstream filtering for task endpoints based on the
 * workstream_visibility_config table and WORKSTREAM_VISIBILITY_DEFAULTS.
 *
 * Resolution priority:
 *   1. User-level override (userId set)
 *   2. Role-level config (role set, userId null)
 *   3. WORKSTREAM_VISIBILITY_DEFAULTS constant
 *   4. ADMIN roles bypass all filters
 */

import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, isNull } from "drizzle-orm";
import {
  workstreamVisibilityConfig,
  WORKSTREAM_VISIBILITY_DEFAULTS,
  normalizeRoleForPermissions,
} from "@shared/schema";
import { getEffectiveUser } from "./auth-context";

const ADMIN_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN"]);

export interface WorkstreamVisibility {
  workstreams: string[];
  ticketTypes: string[];
  scope: string;
  sections: string[];
}

/**
 * Resolve the effective workstream visibility config for a user.
 * Priority: user override > role config > hardcoded defaults > admin bypass.
 */
export async function getEffectiveWorkstreamVisibility(
  userId: number | undefined,
  role: string,
): Promise<WorkstreamVisibility> {
  const normalizedRole = normalizeRoleForPermissions(role);

  // Admin roles get full access — bypass
  if (ADMIN_ROLES.has(normalizedRole)) {
    return {
      workstreams: ["PD", "ENG", "QUALITY", "PM", "FINANCE", "PERSONAL", "GOVERNANCE"],
      ticketTypes: ["pd", "engineering"],
      scope: "all",
      sections: [],
    };
  }

  // 1. Check for a user-level override
  if (userId) {
    try {
      const [userConfig] = await db
        .select()
        .from(workstreamVisibilityConfig)
        .where(eq(workstreamVisibilityConfig.userId, userId));
      if (userConfig) {
        return {
          workstreams: userConfig.workstreams,
          ticketTypes: userConfig.ticketTypes,
          scope: userConfig.scope,
          sections: userConfig.sections,
        };
      }
    } catch {
      // Table may not exist yet — fall through to defaults
    }
  }

  // 2. Check for a role-level config
  if (normalizedRole) {
    try {
      const [roleConfig] = await db
        .select()
        .from(workstreamVisibilityConfig)
        .where(
          and(
            eq(workstreamVisibilityConfig.role, normalizedRole),
            isNull(workstreamVisibilityConfig.userId),
          ),
        );
      if (roleConfig) {
        return {
          workstreams: roleConfig.workstreams,
          ticketTypes: roleConfig.ticketTypes,
          scope: roleConfig.scope,
          sections: roleConfig.sections,
        };
      }
    } catch {
      // Table may not exist yet — fall through to defaults
    }
  }

  // 3. Hardcoded defaults
  const defaults = WORKSTREAM_VISIBILITY_DEFAULTS[normalizedRole];
  if (defaults) {
    return {
      workstreams: defaults.workstreams,
      ticketTypes: defaults.ticketTypes,
      scope: defaults.scope,
      sections: defaults.sections,
    };
  }

  // 4. Unknown role — default to own tasks only with ENG workstream
  return {
    workstreams: ["ENG"],
    ticketTypes: ["pd", "engineering"],
    scope: "own",
    sections: [],
  };
}

/**
 * Express middleware that attaches workstream visibility to req.
 * Downstream handlers can access it via (req as any).workstreamVisibility.
 */
export function attachWorkstreamVisibility(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const user = getEffectiveUser(req);
  if (!user) return next();

  const role = normalizeRoleForPermissions(user.role);
  getEffectiveWorkstreamVisibility(user.id, role)
    .then((visibility) => {
      (req as any).workstreamVisibility = visibility;
      next();
    })
    .catch(() => next());
}

// Error breakdown: TS7006 implicit-any: 16, TS2345 query/param types: 9, other: 4
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, inArray, desc, and, or, isNull, gte } from "drizzle-orm";
import {
  AUTHORITY_ACTIONS,
  ENTITY_PERMISSION_DEFAULTS,
  normalizeRoleForPermissions,
  rolePermissions,
  userPermissionOverrides,
  permissionAuditLog,
  pdVisibilityConfig,
  workstreamVisibilityConfig,
  WORKSTREAM_VISIBILITY_DEFAULTS,
  ROLE_DEPARTMENT_MAP,
  users,
  DEFAULT_ROLE_PERMISSIONS,
  type AuthorityAction,
  type PermissionAction,
  type PermissionEntity,
} from "@shared/schema";
import { evaluateAuthorityForRole, evaluatePermissionForRole } from "@shared/permission-resolver";
import { getLandingPathForRole } from "@shared/navigation/role-landing-paths";
import { getEffectiveUser, jwtAuth, requireAuth, setRevokedUserTokenVersionFloor } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { invalidateEntityPermCache, invalidateUserOverrideCache } from "./permission-middleware";
import bcrypt from "bcryptjs";
import { logAuditFromReq } from "./audit-logger";
import { logPermissionAudit, type PermissionAuditEventType } from "./permission-audit";
import { paramStr, parseIntParam } from "./lib/req-params";
import { z } from "zod";
import { validateBody } from "./middleware/validateBody";

// ── Admin user/role write schemas (Phase 2b-PR2) ──
const updateUserRoleSchema = z.object({ role: z.string().min(1) }).passthrough();
// Task #110 — flip an account active/inactive from the Manage Account drawer.
const updateUserActiveSchema = z.object({ isActive: z.boolean() }).strict();
const createUserSchema = z
  .object({
    username: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(8).max(200),
    role: z.string().min(1).optional(),
    department: z.string().max(200).optional().nullable(),
  })
  .passthrough();

const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "COO_ADMIN",
  quality_manager: "QUALITY_MANAGER",
  eng_program_manager: "ENGINEERING_MANAGER",
  member: "PROGRAM_MANAGER",
};

function mapRole(raw: string): string {
  return normalizeRoleForPermissions(LEGACY_ROLE_MAP[raw] || raw);
}

const VALID_SECTIONS = new Set(["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "HSE", "ENGINEERING", "QUALITY", "FINANCE", "REPORTS", "PRIORITIES", "ADMIN"]);
const SECTION_MIGRATION: Record<string, string[]> = {
  COCKPIT: ["HOME"],
  EXCO: ["PRIORITIES"],
  MY_TOOL: ["HOME"],
  MY_WORK: ["HOME"],
  OPERATIONS: ["PROJECT_DELIVERY"],
  PROJECTS: ["PROJECT_DELIVERY"],
  PROJECT_MANAGEMENT: ["PROJECT_DELIVERY"],
  GOVERNANCE: ["PROJECT_DELIVERY"],
  COLLABORATION: ["PROJECT_DELIVERY"],
  MONEY: ["FINANCE"],
  INFORMATION: ["REPORTS"],
  FEEDBACK: ["REPORTS"],
};


function isRoleProtected(role: { isSystem?: boolean; role: string }) {
  return Boolean(role.isSystem) || ["COO_ADMIN", "CEO_ADMIN"].includes(role.role);
}

function countConfiguredResourcePermissions(entityPermissions: unknown): number {
  if (!entityPermissions || typeof entityPermissions !== "object") return 0;
  const entries = Object.entries(entityPermissions as Record<string, Record<string, boolean>>);
  return entries.filter(([, actions]) => Object.values(actions || {}).some(Boolean)).length;
}

function isMissingRolePermissionsStorage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("no such table") && message.includes("role_permissions");
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseSections(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry));
      }
    } catch {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "t", "yes"].includes(normalized)) return true;
    if (["0", "false", "f", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeRolePermissionRecord(role: any) {
  return {
    ...role,
    sections: migrateSections(parseSections(role.sections)),
    entityPermissions: parseJsonObject(role.entityPermissions),
    authorityModel: parseJsonObject(role.authorityModel),
    canManageUsers: toBoolean(role.canManageUsers),
    canManageRoles: toBoolean(role.canManageRoles),
    canEditData: toBoolean(role.canEditData, true),
    isSystem: toBoolean(role.isSystem),
  };
}

function buildDefaultRolePermissionsSnapshot() {
  return DEFAULT_ROLE_PERMISSIONS.map((perm: any, index: any) =>
    normalizeRolePermissionRecord({
      id: index + 1,
      role: perm.role,
      label: perm.label,
      description: perm.description || null,
      sections: perm.sections,
      canManageUsers: perm.canManageUsers ?? false,
      canManageRoles: perm.canManageRoles ?? false,
      canEditData: perm.canEditData ?? true,
      entityPermissions: null,
      authorityModel: null,
      isSystem: perm.isSystem ?? false,
      createdAt: null,
      updatedAt: null,
    }),
  );
}


async function ensureRolePermissionsSeeded() {
  try {
    const existing = (await db.select().from(rolePermissions)).map(normalizeRolePermissionRecord);
    if (existing.length > 0) return existing;
    await seedRolePermissions();
    const seeded = (await db.select().from(rolePermissions)).map(normalizeRolePermissionRecord);
    return seeded.length > 0 ? seeded : buildDefaultRolePermissionsSnapshot();
  } catch (error) {
    if (isMissingRolePermissionsStorage(error)) {
      return buildDefaultRolePermissionsSnapshot();
    }
    throw error;
  }
}

const SECTION_EXPANSION: Record<string, string[]> = {
  DELIVERY: ["PROJECT_DELIVERY"],
};

function migrateSections(sections: string[]): string[] {
  const migrated = new Set<string>();
  for (const s of sections) {
    if (s.startsWith("!")) {
      migrated.add(s);
      continue;
    }
    if (VALID_SECTIONS.has(s)) {
      migrated.add(s);
    } else if (SECTION_EXPANSION[s]) {
      for (const expanded of SECTION_EXPANSION[s]) migrated.add(expanded);
    } else if (SECTION_MIGRATION[s]) {
      for (const mapped of SECTION_MIGRATION[s]) migrated.add(mapped);
    }
  }
  return [...migrated];
}

type AuthPermissionsPayloadInput = {
  perm: {
    role: string;
    label: string;
    sections: string[];
    canManageUsers: boolean;
    canManageRoles: boolean;
    canEditData: boolean;
    entityPermissions?: Record<string, Record<string, boolean>> | null;
    authorityModel?: Record<string, unknown> | null;
  };
  userOverrides: Record<string, boolean>;
};

export function buildAuthPermissionsPayload({ perm, userOverrides }: AuthPermissionsPayloadInput) {
  return {
    role: perm.role,
    label: perm.label,
    sections: perm.sections,
    canManageUsers: perm.canManageUsers,
    canManageRoles: perm.canManageRoles,
    canEditData: perm.canEditData,
    entityPermissions: perm.entityPermissions || null,
    authorityModel: perm.authorityModel || null,
    landingPath: getLandingPathForRole(perm.role),
    userOverrides: Object.keys(userOverrides).length > 0 ? userOverrides : null,
    authoritySummary: ENTITY_PERMISSION_DEFAULTS.map((rule) => ({
      entity: rule.entity,
      actions: AUTHORITY_ACTIONS.map((action) => {
        const evaluation = evaluateAuthorityForRole({
          role: perm.role,
          entity: rule.entity as PermissionEntity,
          action: action as AuthorityAction,
          roleRecord: perm as any,
        });
        return {
          action,
          allowed: evaluation.allowed,
          scope: evaluation.scope,
          reason: evaluation.reason,
          source: evaluation.source,
        };
      }),
    })),
  };
}

export async function seedRolePermissions() {
  try {
    const existing = await db.select().from(rolePermissions);

    for (const perm of DEFAULT_ROLE_PERMISSIONS) {
      const exists = existing.find((e: any) => e.role === (perm as any).role);
      if (!exists) {
        await db.insert(rolePermissions).values(perm);
      } else {
        const defaultSections = (perm as any).sections as string[];
        const currentSections = migrateSections(parseSections(exists.sections));
        const missingSections = defaultSections.filter(s => !currentSections.includes(s));
        const merged = [...new Set([...currentSections, ...missingSections])];
        const needsUpdate = merged.length !== currentSections.length ||
          merged.some(s => !currentSections.includes(s));
        if (needsUpdate) {
          await db.update(rolePermissions)
            .set({ sections: merged, updatedAt: new Date() })
            .where(eq(rolePermissions.role, (perm as any).role));
        }
      }
    }
    console.log(`[Seed] Role permissions seeded/updated successfully.`);
  } catch (err: any) {
    console.error("[Seed] Role permissions error:", err.message);
  }
}

export function registerRoleManagementRoutes(app: Express) {
  // Reading a role's full permission config is admin-only, with one carve-out:
  // a user may read their OWN role (project pages call GET /api/roles/:role for
  // the signed-in user's role to compute their own tab visibility). Any OTHER
  // role — or the full list — requires admin. Self-match is normalized on both
  // sides so DB-alias vs canonical role keys still line up.
  const requireSelfRoleOrAdmin = (req: Request, res: Response, next: NextFunction) => {
    const rawRequested = req.params.role;
    const requested = normalizeRoleForPermissions(typeof rawRequested === "string" ? rawRequested : null);
    const own = normalizeRoleForPermissions(getEffectiveUser(req)?.role || null);
    if (requested && own && requested === own) return next();
    return requireAdmin(req, res, next);
  };

  app.get("/api/roles", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const roles = await ensureRolePermissionsSeeded();
      res.json(roles);
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/roles/control-center", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const roles = await ensureRolePermissionsSeeded();
      const allUsers = await db.select({ role: users.role }).from(users);
      const roleUserCounts = new Map<string, number>();

      for (const user of allUsers) {
        const mappedRole = mapRole(user.role);
        roleUserCounts.set(mappedRole, (roleUserCounts.get(mappedRole) || 0) + 1);
      }

      const roleSummaries = roles.map((role: any) => ({
        ...role,
        userCount: roleUserCounts.get(role.role) || 0,
        configuredResources: countConfiguredResourcePermissions(role.entityPermissions),
        protected: isRoleProtected(role),
        authoritySummary: ENTITY_PERMISSION_DEFAULTS.map((rule) => ({
          entity: rule.entity,
          actions: AUTHORITY_ACTIONS.map((action) => {
            const evaluation = evaluateAuthorityForRole({
              role: role.role,
              entity: rule.entity as PermissionEntity,
              action: action as AuthorityAction,
              roleRecord: role as any,
            });
            return {
              action,
              allowed: evaluation.allowed,
              scope: evaluation.scope,
              reason: evaluation.reason,
              source: evaluation.source,
            };
          }),
        })),
      }));

      res.json({
        roles: roleSummaries,
        entities: ENTITY_PERMISSION_DEFAULTS,
        actionCatalog: AUTHORITY_ACTIONS,
        scopeCatalog: ["own", "department", "assigned_projects", "all_projects", "company_admin"],
      });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/roles/:role", jwtAuth, requireAuth, requireSelfRoleOrAdmin, async (req: Request, res: Response) => {
    try {
      const roleKey = req.params.role as string;
      const [role] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleKey));
      if (!role) return res.status(404).json({ error: "Role not found" });
      res.json(role);
    } catch (err: any) {
      throw err;
    }
  });

  app.put("/api/roles/:role", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const roleKey = req.params.role as string;
      const { label, description, sections, canManageUsers, canManageRoles, canEditData, entityPermissions: ep, authorityModel } = req.body;

      // UI/UX audit X6 — governed permission/role saves carry an audit
      // justification. The reason is optional at the schema boundary but
      // REQUIRED whenever entity-permission or authority changes are part of
      // the save (those are the security-relevant, high-risk mutations).
      const rawReason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const requiresReason = ep !== undefined || authorityModel !== undefined;
      if (requiresReason && rawReason.length < 5) {
        return res.status(400).json({ error: "A clear reason (min 5 characters) is required when changing role permissions or authority." });
      }
      const auditReason = rawReason.length > 0 ? rawReason : null;

      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleKey));
      if (!existing) return res.status(404).json({ error: "Role not found" });

      // Validate and sanitize sections — ensure it's always a clean string array
      const resolvedSections = sections != null
        ? migrateSections(parseSections(sections))
        : parseSections(existing.sections);

      const updateData: Record<string, any> = {
        label: label ?? existing.label,
        description: description !== undefined ? description : existing.description,
        sections: resolvedSections,
        canManageUsers: canManageUsers ?? existing.canManageUsers,
        canManageRoles: canManageRoles ?? existing.canManageRoles,
        canEditData: canEditData ?? existing.canEditData,
        updatedAt: new Date(),
      };
      if (ep !== undefined) {
        updateData.entityPermissions = ep;
      }
      if (authorityModel !== undefined) {
        updateData.authorityModel = authorityModel;
      }

      const [updated] = await db.update(rolePermissions)
        .set(updateData)
        .where(eq(rolePermissions.role, roleKey))
        .returning();
      invalidateEntityPermCache();
      invalidateUserOverrideCache();
      logAuditFromReq(req, { entityType: "role_permissions", action: "update", entityId: roleKey, changesJson: { description: "Role permissions updated", role: roleKey, sections, canManageUsers, canManageRoles, canEditData, hasEntityPermChanges: ep !== undefined, hasAuthorityModelChanges: authorityModel !== undefined, reason: auditReason } });
      logPermissionAudit(req, { eventType: "role_updated", targetRole: roleKey, changeDetail: { sections, canManageUsers, canManageRoles, canEditData, hasEntityPermChanges: ep !== undefined, hasAuthorityModelChanges: authorityModel !== undefined, reason: auditReason } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Roles] PUT /api/roles/:role error:", err.message);
      throw err;
    }
  });

  app.post("/api/roles", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, label, description, sections, canManageUsers, canManageRoles, canEditData, authorityModel } = req.body;
      if (!role || !label) return res.status(400).json({ error: "Role key and label are required" });

      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
      if (existing) return res.status(409).json({ error: "Role already exists" });

      const [created] = await db.insert(rolePermissions).values({
        role,
        label,
        description: description || null,
        sections: sections || [],
        canManageUsers: canManageUsers || false,
        canManageRoles: canManageRoles || false,
        canEditData: canEditData ?? true,
        authorityModel: authorityModel || null,
        isSystem: false,
      }).returning();
      invalidateEntityPermCache();
      invalidateUserOverrideCache();
      logAuditFromReq(req, { entityType: "role_permissions", action: "create", entityId: role, changesJson: { description: "New role created", role, label, sections } });
      logPermissionAudit(req, { eventType: "role_created", targetRole: role, changeDetail: { label, sections } });
      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });


  app.post("/api/roles/:role/clone", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const sourceRoleKey = req.params.role as string;
      const { role: newRole, label } = req.body;
      if (!newRole || !label) return res.status(400).json({ error: "New role key and label are required" });

      const [source] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, sourceRoleKey));
      if (!source) return res.status(404).json({ error: "Source role not found" });

      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, newRole));
      if (existing) return res.status(409).json({ error: "Target role already exists" });

      const [created] = await db.insert(rolePermissions).values({
        role: newRole,
        label,
        description: source.description,
        sections: source.sections,
        canManageUsers: source.canManageUsers,
        canManageRoles: source.canManageRoles,
        canEditData: source.canEditData,
        entityPermissions: source.entityPermissions,
        authorityModel: source.authorityModel,
        isSystem: false,
      }).returning();

      invalidateEntityPermCache();
      invalidateUserOverrideCache();
      logAuditFromReq(req, { entityType: "role_permissions", action: "clone", entityId: newRole, changesJson: { description: "Role cloned", sourceRole: sourceRoleKey, newRole } });
      logPermissionAudit(req, { eventType: "role_cloned", targetRole: newRole, changeDetail: { sourceRole: sourceRoleKey, label } });
      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/roles/:role/archive", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const roleKey = req.params.role as string;
      const { archived } = req.body as { archived?: boolean };
      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleKey));
      if (!existing) return res.status(404).json({ error: "Role not found" });
      if (isRoleProtected(existing)) {
        logAuditFromReq(req, { entityType: "role_permissions", action: "protected_edit_attempt", entityId: roleKey, changesJson: { description: "Archive attempted on protected role" } });
        return res.status(403).json({ error: "Protected role cannot be archived" });
      }

      const nextLabel = archived ? `${existing.label} (Archived)` : existing.label.replace(/\s*\(Archived\)$/i, "");
      const [updated] = await db.update(rolePermissions)
        .set({ canEditData: archived ? false : existing.canEditData, label: nextLabel, updatedAt: new Date() })
        .where(eq(rolePermissions.role, roleKey))
        .returning();

      invalidateEntityPermCache();
      invalidateUserOverrideCache();
      logAuditFromReq(req, { entityType: "role_permissions", action: archived ? "archive" : "unarchive", entityId: roleKey, changesJson: { description: archived ? "Role archived" : "Role unarchived" } });
      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/roles/effective-access", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role: roleKey, userId } = req.body as { role?: string; userId?: number };
      let effectiveRole = roleKey;
      if (userId && !effectiveRole) {
        const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
        effectiveRole = user?.role;
      }
      if (!effectiveRole) return res.status(400).json({ error: "role or userId is required" });

      const [roleRecord] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, effectiveRole));
      const actions: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

      const legacyMatrix = ENTITY_PERMISSION_DEFAULTS.map((entityRule) => {
        const entity = entityRule.entity as PermissionEntity;
        const actionResults = actions.map((action) => ({ action, ...evaluatePermissionForRole({ role: effectiveRole!, entity, action, roleRecord }) }));
        return { entity, actions: actionResults };
      });

      const authorityMatrix = ENTITY_PERMISSION_DEFAULTS.map((entityRule) => {
        const entity = entityRule.entity as PermissionEntity;
        const actionResults = AUTHORITY_ACTIONS.map((action) => ({
          ...evaluateAuthorityForRole({
            role: effectiveRole!,
            entity,
            action: action as AuthorityAction,
            roleRecord: roleRecord as any,
          }),
          action,
        }));
        return { entity, actions: actionResults };
      });

      res.json({ role: effectiveRole, matrix: legacyMatrix, authorityMatrix });
    } catch (err: any) {
      throw err;
    }
  });


  app.get("/api/roles/effective-summary", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId ? Number(req.query.userId) : null;
      const roleFilter = req.query.role ? String(req.query.role) : null;

      let targetRole = roleFilter;
      if (userId && !targetRole) {
        const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
        targetRole = u?.role || null;
      }

      const roles = targetRole
        ? await db.select().from(rolePermissions).where(eq(rolePermissions.role, targetRole))
        : await db.select().from(rolePermissions);

      const byRole = roles.map((roleRow: any) => ({
        role: roleRow.role,
        label: roleRow.label,
        effective: ENTITY_PERMISSION_DEFAULTS.map((entityRule) => ({
          entity: entityRule.entity,
          actions: AUTHORITY_ACTIONS.map((action) => evaluateAuthorityForRole({
            role: roleRow.role,
            entity: entityRule.entity as PermissionEntity,
            action: action as AuthorityAction,
            roleRecord: roleRow as any,
          })),
        })),
      }));

      res.json({
        byRole,
        requestedUserId: userId,
        requestedRole: targetRole,
      });
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/roles/:role", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const roleKey = req.params.role as string;
      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleKey));
      if (!existing) return res.status(404).json({ error: "Role not found" });
      if (existing.isSystem) return res.status(403).json({ error: "Cannot delete system roles" });

      try {
        const usersWithRole = await db.select({ id: users.id }).from(users).where(eq(users.role, roleKey));
        if (usersWithRole.length > 0) {
          return res.status(409).json({ error: `Cannot delete role. ${usersWithRole.length} user(s) still assigned to this role.` });
        }
      } catch (err) {
        console.error("[RoleManagement] Error checking role assignments before deletion:", err);
        return res.status(500).json({ error: "Failed to verify role assignments before deletion" });
      }

      await db.delete(rolePermissions).where(eq(rolePermissions.role, roleKey));
      invalidateEntityPermCache();
      invalidateUserOverrideCache();
      logAuditFromReq(req, { entityType: "role_permissions", action: "delete", entityId: roleKey, changesJson: { description: "Role deleted", role: roleKey, label: existing.label } });
      logPermissionAudit(req, { eventType: "role_deleted", targetRole: roleKey, changeDetail: { label: existing.label } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/admin/users", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        department: users.department,
        location: users.location,
        isActive: users.isActive,
      }).from(users);
      const mapped = allUsers.map((u: any) => ({
        ...u,
        role: mapRole(u.role),
        isActive: u.isActive !== false && u.isActive !== 0,
      }));
      res.json(mapped);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/admin/users/:userId/role", jwtAuth, requireAuth, requireAdmin, validateBody(updateUserRoleSchema), async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const { role } = req.body;
      if (!role) return res.status(400).json({ error: "Role is required" });

      const [roleExists] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
      if (!roleExists) return res.status(400).json({ error: "Invalid role. Role must exist in role_permissions." });

      const [userBefore] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, userId));
      const [updated] = await db.update(users)
        .set({ role })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) return res.status(404).json({ error: "User not found" });

      // Invalidate existing tokens so user picks up the new role on next request
      setRevokedUserTokenVersionFloor(userId, Date.now());

      logAuditFromReq(req, { entityType: "user", action: "role_change", entityId: String(userId), changesJson: { description: "User role changed", userName: updated.name, previousRole: userBefore?.role, newRole: role } });
      logPermissionAudit(req, { eventType: "user_role_changed", targetUserId: userId, targetRole: role, changeDetail: { userName: updated.name, previousRole: userBefore?.role, newRole: role } });
      res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/admin/users", jwtAuth, requireAuth, requireAdmin, validateBody(createUserSchema), async (req: Request, res: Response) => {
    try {
      const { username, name, email, password, role } = req.body;
      if (!username || !name || !email || !password) {
        return res.status(400).json({ error: "Username, name, email, and password are required" });
      }
      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const [existingUser] = await db.select().from(users).where(eq(users.username, username));
      if (existingUser) return res.status(409).json({ error: "Username already exists" });

      const assignedRole = role || "PROGRAM_MANAGER";
      const department = typeof req.body?.department === "string" ? req.body.department.trim() || null : null;

      const [roleExists] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, assignedRole));
      if (!roleExists) return res.status(400).json({ error: `Role "${assignedRole}" does not exist. Create the role first.` });

      const hashedPassword = await bcrypt.hash(password, 10);

      const [created] = await db.insert(users).values({
        username,
        name,
        email,
        password: hashedPassword,
        role: assignedRole,
        department,
      }).returning();

      logAuditFromReq(req, { entityType: "user", action: "create", entityId: String(created.id), changesJson: { description: "New user created", username, name, email, role: assignedRole, department } });
      res.json({ id: created.id, username: created.username, name: created.name, email: created.email, role: created.role, department: created.department ?? null });
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/admin/users/:userId/department", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const rawDepartment = typeof req.body?.department === "string" ? req.body.department.trim() : "";
      const department = rawDepartment || null;

      const [userBefore] = await db
        .select({ id: users.id, name: users.name, department: users.department })
        .from(users)
        .where(eq(users.id, userId));
      if (!userBefore) return res.status(404).json({ error: "User not found" });

      const [updated] = await db
        .update(users)
        .set({ department })
        .where(eq(users.id, userId))
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role, department: users.department });

      logAuditFromReq(req, {
        entityType: "user",
        action: "department_change",
        entityId: String(userId),
        changesJson: {
          description: "User department changed",
          userName: updated.name,
          previousDepartment: userBefore.department,
          newDepartment: department,
        },
      });

      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  const locationBodySchema = z.object({
    location: z.union([z.string(), z.null()]).optional(),
  });
  app.patch("/api/admin/users/:userId/location", jwtAuth, requireAuth, requireAdmin, validateBody(locationBodySchema), async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.userId);
      if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
      const body = req.body as { location?: string | null };
      const raw = typeof body.location === "string" ? body.location.trim() : "";
      const location = raw ? raw.slice(0, 200) : null;

      const [userBefore] = await db
        .select({ id: users.id, name: users.name, location: users.location })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)));
      if (!userBefore) return res.status(404).json({ error: "User not found" });

      const [updated] = await db
        .update(users)
        .set({ location })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role, department: users.department, location: users.location });

      logAuditFromReq(req, {
        entityType: "user",
        action: "location_change",
        entityId: String(userId),
        changesJson: {
          description: "User location changed",
          userName: updated.name,
          previousLocation: userBefore.location,
          newLocation: location,
        },
      });

      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/admin/users/:userId/password", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const { password } = req.body;
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const [updated] = await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, userId))
        .returning({ id: users.id, name: users.name });

      if (!updated) return res.status(404).json({ error: "User not found" });

      logAuditFromReq(req, { entityType: "user", action: "password_reset", entityId: String(userId), changesJson: { description: "User password reset by admin", userName: updated.name } });
      res.json({ success: true, message: `Password updated for ${updated.name}` });
    } catch (err: any) {
      throw err;
    }
  });

  // Task #110 — admin-controlled active/inactive toggle.
  // Mirrors the same gate as the rest of the Manage Account writes
  // (`requireAdmin` → `requirePermission('admin', 'edit')`). Flipping
  // `isActive: false` is honoured by `fetchUserById` in
  // server/auth-context.ts and by the LocalStrategy in
  // server/bootstrap/auth.ts, so the next request from that account is
  // rejected. We also revoke existing tokens via the
  // `setRevokedUserTokenVersionFloor` floor used by other admin writes.
  app.patch(
    "/api/admin/users/:userId/active",
    jwtAuth,
    requireAuth,
    requireAdmin,
    validateBody(updateUserActiveSchema),
    async (req: Request, res: Response) => {
      try {
        const userId = parseIntParam(req.params.userId);
        if (!Number.isFinite(userId)) {
          return res.status(400).json({ error: "Invalid user id" });
        }
        const { isActive } = req.body as { isActive: boolean };
        const currentUser = getEffectiveUser(req);
        if (currentUser?.id === userId && !isActive) {
          return res.status(400).json({ error: "Cannot deactivate your own account" });
        }

        const [userBefore] = await db
          .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)));
        if (!userBefore) return res.status(404).json({ error: "User not found" });

        const [updated] = await db
          .update(users)
          .set({ isActive })
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .returning({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            department: users.department,
            location: users.location,
            isActive: users.isActive,
          });
        if (!updated) return res.status(404).json({ error: "User not found" });

        // Invalidate existing tokens so a deactivated user is bounced
        // immediately on their next request (without waiting for token expiry).
        setRevokedUserTokenVersionFloor(userId, Date.now());

        logAuditFromReq(req, {
          entityType: "user",
          action: isActive ? "activate" : "deactivate",
          entityId: String(userId),
          changesJson: {
            description: isActive ? "User activated" : "User deactivated",
            userName: updated.name,
            email: updated.email,
            previousIsActive: userBefore.isActive !== false && userBefore.isActive !== 0,
            newIsActive: isActive,
          },
        });
        logPermissionAudit(req, {
          eventType: isActive ? "user_activated" : "user_deactivated",
          targetUserId: userId,
          changeDetail: {
            userName: updated.name,
            email: updated.email,
            previousIsActive: userBefore.isActive !== false && userBefore.isActive !== 0,
            newIsActive: isActive,
          },
        });

        res.json({ ...updated, isActive: updated.isActive !== false && updated.isActive !== 0 });
      } catch (err: any) {
        throw err;
      }
    },
  );

  app.delete("/api/admin/users/:userId", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const currentUser = getEffectiveUser(req);
      if (currentUser?.id === userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      // Soft-delete: mark user as deleted instead of removing the row
      const [deleted] = await db.update(users).set({ deletedAt: new Date(), deletedBy: currentUser?.id ?? null }).where(eq(users.id, userId)).returning();
      if (!deleted) return res.status(404).json({ error: "User not found" });

      logAuditFromReq(req, { entityType: "user", action: "soft_delete", entityId: String(userId), changesJson: { description: "User soft-deleted", userName: deleted.name, email: deleted.email } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/auth/permissions", jwtAuth, async (req: Request, res: Response) => {
    try {
      const companyRole = req.headers["x-company-role"] as string;
      const user = getEffectiveUser(req);
      const userRole = user?.role;
      const raw = companyRole || userRole;

      if (!raw) {
        return res.json({ sections: [], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      const activeRole = mapRole(raw);

      let perm = null as any;
      try {
        const [found] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, activeRole));
        perm = found ? normalizeRolePermissionRecord(found) : null;
      } catch (error) {
        if (!isMissingRolePermissionsStorage(error)) {
          throw error;
        }
        perm = buildDefaultRolePermissionsSnapshot().find((entry) => entry.role === activeRole) || null;
      }
      if (!perm) {
        return res.json({ sections: [], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      // Load user-specific overrides
      let userOverrides: Record<string, boolean> = {};
      if (user?.id) {
        try {
          const overrides = await db.select({
            entity: userPermissionOverrides.entity,
            action: userPermissionOverrides.action,
            allowed: userPermissionOverrides.allowed,
            expiresAt: userPermissionOverrides.expiresAt,
          })
          .from(userPermissionOverrides)
          .where(
            and(
              eq(userPermissionOverrides.userId, user.id),
              isNull(userPermissionOverrides.deletedAt),
              or(
                isNull(userPermissionOverrides.expiresAt),
                gte(userPermissionOverrides.expiresAt, new Date())
              )
            )
          );
          for (const o of overrides) {
            userOverrides[`${o.entity}:${o.action}`] = o.allowed;
          }
        } catch {
          // Table may not exist yet
        }
      }

      res.json(buildAuthPermissionsPayload({ perm, userOverrides }));
    } catch (err: any) {
      throw err;
    }
  });

  // ========== USER PERMISSION OVERRIDES ==========

  app.get("/api/admin/user-overrides/:userId", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.userId);
      if (isNaN(userId)) return res.status(400).json({ error: "Invalid userId" });

      const overrides = await db.select().from(userPermissionOverrides)
        .where(and(eq(userPermissionOverrides.userId, userId), isNull(userPermissionOverrides.deletedAt)));
      res.json(overrides);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/admin/user-overrides", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, entity, action, allowed, scope, reason, expiresAt } = req.body;
      if (!userId || !entity || !action) {
        return res.status(400).json({ error: "userId, entity, and action are required" });
      }
      const normalizedReason = typeof reason === "string" ? reason.trim() : "";
      if (normalizedReason.length < 5) {
        return res.status(400).json({ error: "A clear reason (min 5 characters) is required for permission exceptions" });
      }

      // Upsert: soft-delete existing then insert
      const existingActive = await db.select().from(userPermissionOverrides).where(and(
        eq(userPermissionOverrides.userId, userId),
        eq(userPermissionOverrides.entity, entity),
        eq(userPermissionOverrides.action, action),
        isNull(userPermissionOverrides.deletedAt),
      ));

      await db.update(userPermissionOverrides)
        .set({ deletedAt: new Date(), deletedBy: getEffectiveUser(req)?.id ?? null })
        .where(and(
          eq(userPermissionOverrides.userId, userId),
          eq(userPermissionOverrides.entity, entity),
          eq(userPermissionOverrides.action, action),
          isNull(userPermissionOverrides.deletedAt),
        ));

      const [created] = await db.insert(userPermissionOverrides).values({
        userId,
        entity,
        action,
        allowed: allowed !== false,
        scope: scope || null,
        grantedBy: getEffectiveUser(req)?.id || null,
        reason: normalizedReason,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }).returning();

      invalidateUserOverrideCache(userId);
      logPermissionAudit(req, {
        eventType: existingActive.length > 0 ? "user_override_updated" : "user_override_added",
        targetUserId: userId,
        changeDetail: { entity, action, allowed: allowed !== false, scope, reason: normalizedReason, expiresAt },
      });

      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/admin/user-overrides/:id", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const overrideId = parseIntParam(req.params.id);
      if (isNaN(overrideId)) return res.status(400).json({ error: "Invalid override ID" });

      const [existing] = await db.select().from(userPermissionOverrides)
        .where(eq(userPermissionOverrides.id, overrideId));
      if (!existing) return res.status(404).json({ error: "Override not found" });

      // Soft-delete: mark override as deleted instead of removing the row
      await db.update(userPermissionOverrides)
        .set({ deletedAt: new Date(), deletedBy: getEffectiveUser(req)?.id ?? null })
        .where(eq(userPermissionOverrides.id, overrideId));
      invalidateUserOverrideCache(existing.userId);

      logPermissionAudit(req, {
        eventType: "user_override_removed",
        targetUserId: existing.userId,
        changeDetail: { entity: existing.entity, action: existing.action, wasAllowed: existing.allowed },
      });

      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ========== PERMISSION AUDIT LOG ==========

  app.get("/api/admin/permission-audit-log", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const eventType = req.query.eventType as string;

      let query = db.select({
        id: permissionAuditLog.id,
        eventType: permissionAuditLog.eventType,
        targetRole: permissionAuditLog.targetRole,
        targetUserId: permissionAuditLog.targetUserId,
        changedByUserId: permissionAuditLog.changedByUserId,
        changedByRole: permissionAuditLog.changedByRole,
        changeDetail: permissionAuditLog.changeDetail,
        createdAt: permissionAuditLog.createdAt,
      }).from(permissionAuditLog)
        .orderBy(desc(permissionAuditLog.createdAt))
        .limit(limit)
        .offset(offset);

      if (eventType) {
        query = query.where(eq(permissionAuditLog.eventType, eventType)) as any;
      }

      const rows = await query;

      // Enrich with user names
      const userIds = new Set<number>();
      for (const row of rows) {
        if (row.changedByUserId) userIds.add(row.changedByUserId);
        if (row.targetUserId) userIds.add(row.targetUserId);
      }

      const userMap = new Map<number, string>();
      if (userIds.size > 0) {
        const userRows = await db.select({ id: users.id, name: users.name }).from(users)
          .where(inArray(users.id, [...userIds]));
        for (const u of userRows) {
          userMap.set(u.id, u.name);
        }
      }

      const enriched = rows.map((row: any) => ({
        ...row,
        changedByName: row.changedByUserId ? userMap.get(row.changedByUserId) || null : null,
        targetUserName: row.targetUserId ? userMap.get(row.targetUserId) || null : null,
      }));

      res.json({ entries: enriched, limit, offset });
    } catch (err: any) {
      throw err;
    }
  });

  // ========== PD VISIBILITY CONFIG ==========

  // Get all visibility configs (role-level + user-level)
  app.get("/api/admin/pd-visibility", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const configs = await db.select().from(pdVisibilityConfig);
      res.json(configs);
    } catch (err: any) {
      throw err;
    }
  });

  // Upsert a role-level visibility config
  app.put("/api/admin/pd-visibility/role", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, ticketTypes, scope } = req.body;
      if (!role) return res.status(400).json({ error: "role is required" });

      const adminUser = getEffectiveUser(req);

      // Delete existing role config, then insert
      await db.delete(pdVisibilityConfig)
        .where(and(eq(pdVisibilityConfig.role, role), isNull(pdVisibilityConfig.userId)));

      const [created] = await db.insert(pdVisibilityConfig).values({
        role,
        userId: null,
        ticketTypes: ticketTypes || ["pd", "engineering"],
        scope: scope || "all",
        updatedBy: adminUser?.id || null,
      }).returning();

      logPermissionAudit(req, {
        eventType: "pd_visibility_role_updated" as PermissionAuditEventType,
        targetRole: role,
        changeDetail: { ticketTypes: created.ticketTypes, scope: created.scope },
      });

      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });

  // Upsert a user-level visibility config (override)
  app.put("/api/admin/pd-visibility/user", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, ticketTypes, scope } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });

      const adminUser = getEffectiveUser(req);

      // Delete existing user config, then insert
      await db.delete(pdVisibilityConfig)
        .where(eq(pdVisibilityConfig.userId, userId));

      const [created] = await db.insert(pdVisibilityConfig).values({
        role: null,
        userId,
        ticketTypes: ticketTypes || ["pd", "engineering"],
        scope: scope || "all",
        updatedBy: adminUser?.id || null,
      }).returning();

      logPermissionAudit(req, {
        eventType: "pd_visibility_user_updated" as PermissionAuditEventType,
        targetUserId: userId,
        changeDetail: { ticketTypes: created.ticketTypes, scope: created.scope },
      });

      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });

  // Delete a visibility config by ID
  app.delete("/api/admin/pd-visibility/:id", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const configId = parseIntParam(req.params.id);
      if (isNaN(configId)) return res.status(400).json({ error: "Invalid config ID" });

      const [existing] = await db.select().from(pdVisibilityConfig)
        .where(eq(pdVisibilityConfig.id, configId));
      if (!existing) return res.status(404).json({ error: "Config not found" });

      await db.delete(pdVisibilityConfig).where(eq(pdVisibilityConfig.id, configId));

      logPermissionAudit(req, {
        eventType: (existing.userId ? "pd_visibility_user_removed" : "pd_visibility_role_removed") as PermissionAuditEventType,
        targetRole: existing.role || undefined,
        targetUserId: existing.userId || undefined,
        changeDetail: { ticketTypes: existing.ticketTypes, scope: existing.scope },
      });

      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ========== WORKSTREAM VISIBILITY CONFIG ==========

  // Get all workstream visibility configs + defaults for roles without config
  app.get("/api/admin/workstream-visibility", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      let configs: any[] = [];
      try {
        configs = await db.select().from(workstreamVisibilityConfig);
      } catch {
        // Table may not exist yet
      }
      res.json({
        configs,
        defaults: WORKSTREAM_VISIBILITY_DEFAULTS,
        roleDepartmentMap: ROLE_DEPARTMENT_MAP,
      });
    } catch (err: any) {
      throw err;
    }
  });

  // Upsert a role-level workstream visibility config
  app.put("/api/admin/workstream-visibility/role", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, workstreams, ticketTypes, scope, sections } = req.body;
      if (!role) return res.status(400).json({ error: "role is required" });

      const adminUser = getEffectiveUser(req);

      // Delete existing role config, then insert
      await db.delete(workstreamVisibilityConfig)
        .where(and(eq(workstreamVisibilityConfig.role, role), isNull(workstreamVisibilityConfig.userId)));

      const [created] = await db.insert(workstreamVisibilityConfig).values({
        role,
        userId: null,
        workstreams: workstreams || ["ENG", "PD", "PM", "QUALITY", "FINANCE", "GOVERNANCE", "PERSONAL"],
        ticketTypes: ticketTypes || ["pd", "engineering"],
        scope: scope || "all",
        sections: sections || [],
        updatedBy: adminUser?.id || null,
      }).returning();

      // Also sync to legacy pdVisibilityConfig for backward compatibility
      await db.delete(pdVisibilityConfig)
        .where(and(eq(pdVisibilityConfig.role, role), isNull(pdVisibilityConfig.userId)));
      await db.insert(pdVisibilityConfig).values({
        role,
        userId: null,
        ticketTypes: ticketTypes || ["pd", "engineering"],
        scope: scope || "all",
        updatedBy: adminUser?.id || null,
      });

      logPermissionAudit(req, {
        eventType: "workstream_visibility_role_updated" as PermissionAuditEventType,
        targetRole: role,
        changeDetail: { workstreams: created.workstreams, ticketTypes: created.ticketTypes, scope: created.scope },
      });

      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });

  // Upsert a user-level workstream visibility config (override)
  app.put("/api/admin/workstream-visibility/user", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, workstreams, ticketTypes, scope, sections } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });

      const adminUser = getEffectiveUser(req);

      await db.delete(workstreamVisibilityConfig)
        .where(eq(workstreamVisibilityConfig.userId, userId));

      const [created] = await db.insert(workstreamVisibilityConfig).values({
        role: null,
        userId,
        workstreams: workstreams || ["ENG", "PD", "PM", "QUALITY", "FINANCE", "GOVERNANCE", "PERSONAL"],
        ticketTypes: ticketTypes || ["pd", "engineering"],
        scope: scope || "all",
        sections: sections || [],
        updatedBy: adminUser?.id || null,
      }).returning();

      // Sync to legacy table
      await db.delete(pdVisibilityConfig)
        .where(eq(pdVisibilityConfig.userId, userId));
      await db.insert(pdVisibilityConfig).values({
        role: null,
        userId,
        ticketTypes: ticketTypes || ["pd", "engineering"],
        scope: scope || "all",
        updatedBy: adminUser?.id || null,
      });

      logPermissionAudit(req, {
        eventType: "workstream_visibility_user_updated" as PermissionAuditEventType,
        targetUserId: userId,
        changeDetail: { workstreams: created.workstreams, ticketTypes: created.ticketTypes, scope: created.scope },
      });

      res.json(created);
    } catch (err: any) {
      throw err;
    }
  });

  // Delete a workstream visibility config by ID
  app.delete("/api/admin/workstream-visibility/:id", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const configId = parseIntParam(req.params.id);
      if (isNaN(configId)) return res.status(400).json({ error: "Invalid config ID" });

      const [existing] = await db.select().from(workstreamVisibilityConfig)
        .where(eq(workstreamVisibilityConfig.id, configId));
      if (!existing) return res.status(404).json({ error: "Config not found" });

      await db.delete(workstreamVisibilityConfig).where(eq(workstreamVisibilityConfig.id, configId));

      logPermissionAudit(req, {
        eventType: (existing.userId ? "workstream_visibility_user_removed" : "workstream_visibility_role_removed") as PermissionAuditEventType,
        targetRole: existing.role || undefined,
        targetUserId: existing.userId || undefined,
        changeDetail: { workstreams: existing.workstreams, ticketTypes: existing.ticketTypes, scope: existing.scope },
      });

      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // GET /api/admin/users/:id/effective-permissions
  // Computes the full effective permission matrix for a user by merging:
  // 1. Hardcoded defaults (ENTITY_PERMISSION_DEFAULTS)
  // 2. Role DB overrides (rolePermissions.entityPermissions)
  // 3. User-level overrides (userPermissionOverrides)
  app.get("/api/admin/users/:id/effective-permissions", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseIntParam(req.params.id);
      if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ error: "User not found" });

      const userRole = mapRole(user.role);

      // Get role record
      const allRoles = await ensureRolePermissionsSeeded();
      const roleRecord = allRoles.find((r: any) => r.role === userRole) || null;

      // Get user overrides (non-expired)
      const overrides = await db.select({
        entity: userPermissionOverrides.entity,
        action: userPermissionOverrides.action,
        allowed: userPermissionOverrides.allowed,
      }).from(userPermissionOverrides).where(
        and(
          eq(userPermissionOverrides.userId, userId),
          or(
            isNull(userPermissionOverrides.expiresAt),
            gte(userPermissionOverrides.expiresAt, new Date())
          )
        )
      );

      const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];
      const permissions: Array<{
        entity: string;
        action: string;
        allowed: boolean;
        source: string;
      }> = [];

      for (const rule of ENTITY_PERMISSION_DEFAULTS) {
        for (const action of ACTIONS) {
          // 1. Check user override
          const userOverride = overrides.find((o: any) => o.entity === rule.entity && o.action === action);
          if (userOverride) {
            permissions.push({
              entity: rule.entity,
              action,
              allowed: userOverride.allowed,
              source: userOverride.allowed ? "user_override_grant" : "user_override_deny",
            });
            continue;
          }

          // 2. Check role DB override
          const evalResult = evaluatePermissionForRole({
            role: userRole,
            entity: rule.entity as PermissionEntity,
            action,
            roleRecord: roleRecord as any,
          });

          permissions.push({
            entity: rule.entity,
            action,
            allowed: evalResult.allowed,
            source: evalResult.source === "db_override" ? "role_override" : evalResult.source,
          });
        }
      }

      res.json({
        userId,
        userName: user.name,
        role: userRole,
        permissions,
        overrideCount: overrides.length,
      });
    } catch (err: any) {
      throw err;
    }
  });

  // GET /api/roles/compare?roles=ROLE1,ROLE2
  // Returns side-by-side permission comparison for 2+ roles
  app.get("/api/roles/compare", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const rolesParam = req.query.roles as string;
      if (!rolesParam) return res.status(400).json({ error: "roles query parameter required" });

      const roleNames = rolesParam.split(",").map((r) => r.trim()).filter(Boolean);
      if (roleNames.length < 2) return res.status(400).json({ error: "At least 2 roles required" });
      if (roleNames.length > 5) return res.status(400).json({ error: "Maximum 5 roles for comparison" });

      const allRoles = await ensureRolePermissionsSeeded();
      const roleRecords = roleNames.map((name) => allRoles.find((r: any) => r.role === name)).filter(Boolean);

      if (roleRecords.length < 2) return res.status(404).json({ error: "One or more roles not found" });

      const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

      const comparison: Array<{
        entity: string;
        permissions: Record<string, Record<string, { allowed: boolean; source: string }>>;
        hasDifference: boolean;
      }> = [];

      for (const rule of ENTITY_PERMISSION_DEFAULTS) {
        const entityPerms: Record<string, Record<string, { allowed: boolean; source: string }>> = {};
        let hasDiff = false;

        for (const action of ACTIONS) {
          const results: Array<{ allowed: boolean; source: string }> = [];

          for (const roleRec of roleRecords) {
            const evalResult = evaluatePermissionForRole({
              role: roleRec.role,
              entity: rule.entity as PermissionEntity,
              action,
              roleRecord: roleRec as any,
            });

            if (!entityPerms[roleRec.role]) entityPerms[roleRec.role] = {};
            entityPerms[roleRec.role][action] = {
              allowed: evalResult.allowed,
              source: evalResult.source,
            };

            results.push({ allowed: evalResult.allowed, source: evalResult.source });
          }

          // Check if there's a difference across roles for this action
          if (results.some((r) => r.allowed !== results[0].allowed)) {
            hasDiff = true;
          }
        }

        comparison.push({ entity: rule.entity, permissions: entityPerms, hasDifference: hasDiff });
      }

      // Also compare navigation sections
      const navComparison: Record<string, Record<string, boolean>> = {};
      for (const roleRec of roleRecords) {
        const sections = (roleRec as any).sections || [];
        navComparison[roleRec.role] = {};
        for (const sec of ["HOME", "MY_WORK", "PROJECTS", "FINANCE", "REPORTS", "ADMIN"]) {
          navComparison[roleRec.role][sec] = sections.includes(sec);
        }
      }

      res.json({
        roles: roleRecords.map((r) => ({ role: r.role, label: (r as any).label || r.role })),
        entityComparison: comparison,
        navigationComparison: navComparison,
        differenceCount: comparison.filter((c) => c.hasDifference).length,
      });
    } catch (err: any) {
      throw err;
    }
  });
}

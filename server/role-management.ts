import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import {
  AUTHORITY_ACTIONS,
  ENTITY_PERMISSION_DEFAULTS,
  normalizeRoleForPermissions,
  rolePermissions,
  users,
  DEFAULT_ROLE_PERMISSIONS,
  type AuthorityAction,
  type PermissionAction,
  type PermissionEntity,
} from "@shared/schema";
import { evaluateAuthorityForRole, evaluatePermissionForRole } from "@shared/permission-resolver";
import { verifyToken } from "./jwt";
import { invalidateEntityPermCache } from "./permission-middleware";
import bcrypt from "bcryptjs";
import { logAuditFromReq } from "./audit-logger";

const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "COO_ADMIN",
  quality_manager: "QUALITY_MANAGER",
  eng_program_manager: "ENGINEERING_MANAGER",
  member: "PROGRAM_MANAGER",
};

function mapRole(raw: string): string {
  return normalizeRoleForPermissions(LEGACY_ROLE_MAP[raw] || raw);
}

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const payload = verifyToken(authHeader.substring(7));
    if (payload) {
      (req as any).user = payload;
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  res.status(401).json({ error: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const role = mapRole(user.role);
  const adminRoles = ["COO_ADMIN", "CEO_ADMIN"];
  if (adminRoles.includes(role)) return next();
  res.status(403).json({ error: "Admin access required" });
}

const VALID_SECTIONS = new Set(["COCKPIT", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "COLLABORATION", "INFORMATION", "ADMIN"]);
const SECTION_MIGRATION: Record<string, string> = {
  EXCO: "COCKPIT",
  MY_TOOL: "COCKPIT",
  PROJECT_MANAGEMENT: "PROJECTS",
  OPERATIONS: "PROJECTS",
  FINANCE: "MONEY",
  ENGINEERING: "DELIVERY",
  QUALITY: "GOVERNANCE",
  FEEDBACK: "INFORMATION",
};


function isRoleProtected(role: { isSystem?: boolean; role: string }) {
  return Boolean(role.isSystem) || ["COO_ADMIN", "CEO_ADMIN"].includes(role.role);
}

function countConfiguredResourcePermissions(entityPermissions: unknown): number {
  if (!entityPermissions || typeof entityPermissions !== "object") return 0;
  const entries = Object.entries(entityPermissions as Record<string, Record<string, boolean>>);
  return entries.filter(([, actions]) => Object.values(actions || {}).some(Boolean)).length;
}


async function ensureRolePermissionsSeeded() {
  const existing = await db.select().from(rolePermissions);
  if (existing.length > 0) return existing;
  await seedRolePermissions();
  return db.select().from(rolePermissions);
}

function migrateSections(sections: string[]): string[] {
  const migrated = new Set<string>();
  for (const s of sections) {
    if (VALID_SECTIONS.has(s)) {
      migrated.add(s);
    } else if (SECTION_MIGRATION[s]) {
      migrated.add(SECTION_MIGRATION[s]);
    }
  }
  return [...migrated];
}

export async function seedRolePermissions() {
  try {
    const existing = await db.select().from(rolePermissions);

    for (const perm of DEFAULT_ROLE_PERMISSIONS) {
      const exists = existing.find((e: any) => e.role === perm.role);
      if (!exists) {
        await db.insert(rolePermissions).values(perm);
      } else {
        const defaultSections = perm.sections as string[];
        const currentSections = migrateSections((exists.sections || []) as string[]);
        const missingSections = defaultSections.filter(s => !currentSections.includes(s));
        const merged = [...new Set([...currentSections, ...missingSections])];
        const needsUpdate = merged.length !== (exists.sections as string[]).length ||
          merged.some(s => !(exists.sections as string[]).includes(s));
        if (needsUpdate) {
          await db.update(rolePermissions)
            .set({ sections: merged, updatedAt: new Date() })
            .where(eq(rolePermissions.role, perm.role));
        }
      }
    }
    console.log(`[Seed] Role permissions seeded/updated successfully.`);
  } catch (err: any) {
    console.error("[Seed] Role permissions error:", err.message);
  }
}

export function registerRoleManagementRoutes(app: Express) {
  app.get("/api/roles", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const roles = await ensureRolePermissionsSeeded();
      res.json(roles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/roles/control-center", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const roles = await ensureRolePermissionsSeeded();
      const userCounts = await db
        .select({ role: users.role, count: sql<number>`count(*)::int` })
        .from(users)
        .groupBy(users.role);

      const roleUserCounts = new Map(userCounts.map((row: any) => [mapRole(row.role), Number(row.count || 0)]));
      const roleSummaries = roles.map((role) => ({
        ...role,
        userCount: roleUserCounts.get(role.role) || 0,
        configuredResources: countConfiguredResourcePermissions(role.entityPermissions),
        protected: isRoleProtected(role),
      }));

      res.json({
        roles: roleSummaries,
        entities: ENTITY_PERMISSION_DEFAULTS,
        actionCatalog: AUTHORITY_ACTIONS,
        scopeCatalog: ["own", "department", "assigned_projects", "all_projects", "company_admin"],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/roles/:role", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const roleKey = req.params.role as string;
      const [role] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleKey));
      if (!role) return res.status(404).json({ error: "Role not found" });
      res.json(role);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/roles/:role", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const roleKey = req.params.role as string;
      const { label, description, sections, canManageUsers, canManageRoles, canEditData, entityPermissions: ep, authorityModel } = req.body;
      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, roleKey));
      if (!existing) return res.status(404).json({ error: "Role not found" });

      const updateData: Record<string, any> = {
        label: label ?? existing.label,
        description: description ?? existing.description,
        sections: sections ?? existing.sections,
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
      logAuditFromReq(req, { entityType: "role_permissions", action: "update", entityId: roleKey, changesJson: { description: "Role permissions updated", role: roleKey, sections, canManageUsers, canManageRoles, canEditData, hasEntityPermChanges: ep !== undefined, hasAuthorityModelChanges: authorityModel !== undefined } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      logAuditFromReq(req, { entityType: "role_permissions", action: "create", entityId: role, changesJson: { description: "New role created", role, label, sections } });
      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      logAuditFromReq(req, { entityType: "role_permissions", action: "clone", entityId: newRole, changesJson: { description: "Role cloned", sourceRole: sourceRoleKey, newRole } });
      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      logAuditFromReq(req, { entityType: "role_permissions", action: archived ? "archive" : "unarchive", entityId: roleKey, changesJson: { description: archived ? "Role archived" : "Role unarchived" } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
          action,
          ...evaluateAuthorityForRole({
            role: effectiveRole!,
            entity,
            action: action as AuthorityAction,
            roleRecord: roleRecord as any,
          }),
        }));
        return { entity, actions: actionResults };
      });

      res.json({ role: effectiveRole, matrix: legacyMatrix, authorityMatrix });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      const byRole = roles.map((roleRow) => ({
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
      res.status(500).json({ error: err.message });
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
      } catch {
      }

      await db.delete(rolePermissions).where(eq(rolePermissions.role, roleKey));
      logAuditFromReq(req, { entityType: "role_permissions", action: "delete", entityId: roleKey, changesJson: { description: "Role deleted", role: roleKey, label: existing.label } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/users", jwtAuth, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      }).from(users);
      const mapped = allUsers.map((u: any) => ({ ...u, role: mapRole(u.role) }));
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/users/:userId/role", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId as string);
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

      logAuditFromReq(req, { entityType: "user", action: "role_change", entityId: String(userId), changesJson: { description: "User role changed", userName: updated.name, previousRole: userBefore?.role, newRole: role } });
      res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/users", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, name, email, password, role } = req.body;
      if (!username || !name || !email || !password) {
        return res.status(400).json({ error: "Username, name, email, and password are required" });
      }

      const [existingUser] = await db.select().from(users).where(eq(users.username, username));
      if (existingUser) return res.status(409).json({ error: "Username already exists" });

      const assignedRole = role || "PROGRAM_MANAGER";

      const [roleExists] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, assignedRole));
      if (!roleExists) return res.status(400).json({ error: `Role "${assignedRole}" does not exist. Create the role first.` });

      const hashedPassword = await bcrypt.hash(password, 10);

      const [created] = await db.insert(users).values({
        username,
        name,
        email,
        password: hashedPassword,
        role: assignedRole,
      }).returning();

      logAuditFromReq(req, { entityType: "user", action: "create", entityId: String(created.id), changesJson: { description: "New user created", username, name, email, role: assignedRole } });
      res.json({ id: created.id, username: created.username, name: created.name, email: created.email, role: created.role });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/users/:userId/password", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId as string);
      const { password } = req.body;
      if (!password || password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters" });
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
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/users/:userId", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId as string);
      const currentUser = (req as any).user;
      if (currentUser?.id === userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      const [deleted] = await db.delete(users).where(eq(users.id, userId)).returning();
      if (!deleted) return res.status(404).json({ error: "User not found" });

      logAuditFromReq(req, { entityType: "user", action: "delete", entityId: String(userId), changesJson: { description: "User deleted", userName: deleted.name, email: deleted.email } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/auth/permissions", jwtAuth, async (req: Request, res: Response) => {
    try {
      const companyRole = req.headers["x-company-role"] as string;
      const userRole = (req as any).user?.role;
      const raw = companyRole || userRole;

      if (!raw) {
        return res.json({ sections: ["PROJECTS"], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      const activeRole = mapRole(raw);

      const [perm] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, activeRole));
      if (!perm) {
        return res.json({ sections: ["PROJECTS"], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      res.json({
        role: perm.role,
        label: perm.label,
        sections: perm.sections,
        canManageUsers: perm.canManageUsers,
        canManageRoles: perm.canManageRoles,
        canEditData: perm.canEditData,
        entityPermissions: perm.entityPermissions || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

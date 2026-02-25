import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { rolePermissions, users, DEFAULT_ROLE_PERMISSIONS } from "@shared/schema";
import { verifyToken } from "./jwt";
import { invalidateEntityPermCache } from "./permission-middleware";
import bcrypt from "bcryptjs";

const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "COO_ADMIN",
  quality_manager: "QUALITY_MANAGER",
  eng_program_manager: "ENGINEERING_MANAGER",
  member: "PROGRAM_MANAGER",
};

function mapRole(raw: string): string {
  return LEGACY_ROLE_MAP[raw] || raw;
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

export async function seedRolePermissions() {
  try {
    const existing = await db.select().from(rolePermissions);

    for (const perm of DEFAULT_ROLE_PERMISSIONS) {
      const exists = existing.find((e: any) => e.role === perm.role);
      if (!exists) {
        await db.insert(rolePermissions).values(perm);
      } else {
        const defaultSections = perm.sections as string[];
        const currentSections = (exists.sections || []) as string[];
        const missingSections = defaultSections.filter(s => !currentSections.includes(s));
        if (missingSections.length > 0) {
          const merged = [...currentSections, ...missingSections];
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
      const roles = await db.select().from(rolePermissions);
      res.json(roles);
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
      const { label, description, sections, canManageUsers, canManageRoles, canEditData, entityPermissions: ep } = req.body;
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

      const [updated] = await db.update(rolePermissions)
        .set(updateData)
        .where(eq(rolePermissions.role, roleKey))
        .returning();
      invalidateEntityPermCache();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/roles", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, label, description, sections, canManageUsers, canManageRoles, canEditData } = req.body;
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
        isSystem: false,
      }).returning();
      res.json(created);
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

      const [updated] = await db.update(users)
        .set({ role })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) return res.status(404).json({ error: "User not found" });

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
        return res.json({ sections: ["PROJECT_MANAGEMENT"], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      const activeRole = mapRole(raw);

      const [perm] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, activeRole));
      if (!perm) {
        return res.json({ sections: ["PROJECT_MANAGEMENT"], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      res.json({
        role: perm.role,
        label: perm.label,
        sections: perm.sections,
        canManageUsers: perm.canManageUsers,
        canManageRoles: perm.canManageRoles,
        canEditData: perm.canEditData,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

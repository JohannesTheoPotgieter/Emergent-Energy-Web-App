import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { rolePermissions, users, DEFAULT_ROLE_PERMISSIONS } from "@shared/schema";
import type { InsertRolePermission, RolePermission } from "@shared/schema";

export async function seedRolePermissions() {
  try {
    const existing = await db.select().from(rolePermissions);
    if (existing.length >= DEFAULT_ROLE_PERMISSIONS.length) {
      console.log(`[Seed] Role permissions already present (${existing.length}), skipping.`);
      return;
    }

    for (const perm of DEFAULT_ROLE_PERMISSIONS) {
      const exists = existing.find(e => e.role === perm.role);
      if (!exists) {
        await db.insert(rolePermissions).values(perm);
      }
    }
    console.log(`[Seed] Role permissions seeded successfully.`);
  } catch (err: any) {
    console.error("[Seed] Role permissions error:", err.message);
  }
}

export function registerRoleManagementRoutes(app: Express) {
  app.get("/api/roles", async (_req: Request, res: Response) => {
    try {
      const roles = await db.select().from(rolePermissions);
      res.json(roles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/roles/:role", async (req: Request, res: Response) => {
    try {
      const [role] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, req.params.role));
      if (!role) return res.status(404).json({ error: "Role not found" });
      res.json(role);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/roles/:role", async (req: Request, res: Response) => {
    try {
      const { label, description, sections, canManageUsers, canManageRoles, canEditData } = req.body;
      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, req.params.role));
      if (!existing) return res.status(404).json({ error: "Role not found" });

      const [updated] = await db.update(rolePermissions)
        .set({
          label: label ?? existing.label,
          description: description ?? existing.description,
          sections: sections ?? existing.sections,
          canManageUsers: canManageUsers ?? existing.canManageUsers,
          canManageRoles: canManageRoles ?? existing.canManageRoles,
          canEditData: canEditData ?? existing.canEditData,
          updatedAt: new Date(),
        })
        .where(eq(rolePermissions.role, req.params.role))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/roles", async (req: Request, res: Response) => {
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

  app.delete("/api/roles/:role", async (req: Request, res: Response) => {
    try {
      const [existing] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, req.params.role));
      if (!existing) return res.status(404).json({ error: "Role not found" });
      if (existing.isSystem) return res.status(403).json({ error: "Cannot delete system roles" });

      const usersWithRole = await db.select({ id: users.id }).from(users).where(eq(users.role, req.params.role as any));
      if (usersWithRole.length > 0) {
        return res.status(409).json({ error: `Cannot delete role. ${usersWithRole.length} user(s) still assigned to this role.` });
      }

      await db.delete(rolePermissions).where(eq(rolePermissions.role, req.params.role));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/users", async (_req: Request, res: Response) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      }).from(users);
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/users/:userId/role", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
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

  app.get("/api/auth/permissions", async (req: Request, res: Response) => {
    try {
      const companyRole = req.headers["x-company-role"] as string;
      const userRole = (req as any).user?.role;
      const activeRole = companyRole || userRole;

      if (!activeRole) {
        return res.json({ sections: [], canManageUsers: false, canManageRoles: false, canEditData: false });
      }

      const [perm] = await db.select().from(rolePermissions).where(eq(rolePermissions.role, activeRole));
      if (!perm) {
        return res.json({ sections: [], canManageUsers: false, canManageRoles: false, canEditData: false });
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

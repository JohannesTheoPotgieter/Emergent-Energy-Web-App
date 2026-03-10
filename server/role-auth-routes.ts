import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { generateToken, verifyToken } from "./jwt";
import {
  roleCredentials,
  auditEvents,
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  ADMIN_ROLES,
  type CompanyRole,
} from "@shared/schema";
import { ApiError, sendError, badRequest, unauthorized, forbidden, serverError, logApiError } from "./lib/api-error";

function isValidCompanyRole(role: string): role is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(role);
}

export function requireCompanyRole(...allowedRoles: CompanyRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, unauthorized("Authorization header required"));
    }
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (!payload) {
      return sendError(res, new ApiError(401, "INVALID_TOKEN", "Invalid or expired token"));
    }
    const role = (payload as any).role as string;
    if (!role || !allowedRoles.includes(role as CompanyRole)) {
      return sendError(res, forbidden(`Requires one of: ${allowedRoles.join(", ")}`));
    }
    (req as any).companyRole = role;
    (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role };
    next();
  };
}

export async function seedRoleCredentials() {
  try {
    const existing = await db.select().from(roleCredentials);
    if (existing.length > 0) return;

    const defaultPasswords: Record<string, string> = {
      COO_ADMIN: "2024",
      CEO_ADMIN: "ceo2026",
    };

    for (const role of COMPANY_ROLES) {
      const password = defaultPasswords[role] || "emergent2026";
      const passwordHash = await bcrypt.hash(password, 10);
      await db.insert(roleCredentials).values({
        role,
        passwordHash,
        lastPasswordPlain: password,
        failedAttempts: 0,
        updatedBy: "system",
      });
    }
    console.log("[ROLE-AUTH] Seeded default role credentials");
  } catch (err: any) {
    console.error("[ROLE-AUTH] Error seeding role credentials:", err.message);
  }
}

export function registerRoleAuthRoutes(app: Express) {
  app.post("/api/role-auth/login", async (req: Request, res: Response) => {
    try {
      const { role, password } = req.body;

      if (!role || !password) {
        return sendError(res, badRequest("Role and password are required"));
      }

      if (!isValidCompanyRole(role)) {
        return sendError(res, badRequest("Invalid company role"));
      }

      const [cred] = await db.select().from(roleCredentials).where(eq(roleCredentials.role, role));
      if (!cred) {
        return sendError(res, new ApiError(404, "ROLE_NOT_FOUND", "Role credentials not configured. Run seed first."));
      }

      if (cred.failedAttempts >= 5 && cred.lockedUntil && new Date(cred.lockedUntil) > new Date()) {
        const lockoutRemaining = Math.ceil((new Date(cred.lockedUntil).getTime() - Date.now()) / 1000);
        return sendError(
          res,
          new ApiError(429, "ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${Math.ceil(lockoutRemaining / 60)} minutes.`, {
            lockedUntil: String(cred.lockedUntil),
            retryAfterSeconds: String(lockoutRemaining),
          }),
        );
      }

      const isMatch = await bcrypt.compare(password, cred.passwordHash);

      if (!isMatch) {
        const newAttempts = cred.failedAttempts + 1;
        const updates: any = { failedAttempts: newAttempts, updatedAt: new Date() };
        if (newAttempts >= 5) {
          updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        }
        await db.update(roleCredentials).set(updates).where(eq(roleCredentials.id, cred.id));

        await db.insert(auditEvents).values({
          actorRole: role,
          source: "UI",
          entityType: "role_auth",
          entityId: role,
          action: "login_failed",
          changesJson: { failedAttempts: newAttempts },
        });

        return sendError(res, new ApiError(401, "INVALID_PASSWORD", "Invalid password"));
      }

      await db.update(roleCredentials).set({
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      }).where(eq(roleCredentials.id, cred.id));

      const label = COMPANY_ROLE_LABELS[role];
      const token = generateToken({
        userId: 0,
        email: `${role}@role.local`,
        name: label,
        role: role as any,
      });

      await db.insert(auditEvents).values({
        actorRole: role,
        source: "UI",
        entityType: "role_auth",
        entityId: role,
        action: "login_success",
      });

      return res.json({
        token,
        role,
        label,
        isAdmin: (ADMIN_ROLES as readonly string[]).includes(role),
      });
    } catch (err: any) {
      console.error("[ROLE-AUTH] Login error:", err.message);
      logApiError("POST /api/role-auth/login", err);
      return sendError(res, serverError("Login failed"));
    }
  });

  app.post("/api/role-auth/seed", async (_req: Request, res: Response) => {
    try {
      const existing = await db.select().from(roleCredentials);
      if (existing.length > 0) {
        return res.json({ message: "Role credentials already seeded", count: existing.length });
      }
      await seedRoleCredentials();
      return res.json({ message: "Role credentials seeded successfully", count: COMPANY_ROLES.length });
    } catch (err: any) {
      console.error("[ROLE-AUTH] Seed error:", err.message);
      logApiError("POST /api/role-auth/seed", err);
      return sendError(res, serverError("Seed failed"));
    }
  });

  app.get("/api/role-auth/me", (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return sendError(res, unauthorized("Authorization header required"));
      }
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (!payload) {
        return sendError(res, new ApiError(401, "INVALID_TOKEN", "Invalid or expired token"));
      }
      const role = (payload as any).role as string;
      const label = isValidCompanyRole(role) ? COMPANY_ROLE_LABELS[role] : role;
      return res.json({ role, label });
    } catch (err: any) {
      logApiError("GET /api/role-auth/me", err);
      return sendError(res, serverError("Failed to get session"));
    }
  });

  app.get("/api/role-auth/roles", (_req: Request, res: Response) => {
    const roles = COMPANY_ROLES.map((role) => ({
      role,
      label: COMPANY_ROLE_LABELS[role],
      isAdmin: (ADMIN_ROLES as readonly string[]).includes(role),
    }));
    return res.json(roles);
  });

  app.patch("/api/role-auth/password", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return sendError(res, unauthorized("Authorization header required"));
      }
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (!payload) {
        return sendError(res, new ApiError(401, "INVALID_TOKEN", "Invalid or expired token"));
      }

      const currentRole = (payload as any).role as string;
      if (currentRole !== "COO_ADMIN") {
        return sendError(res, forbidden("Only COO_ADMIN can change passwords"));
      }

      const { targetRole, newPassword } = req.body;
      if (!targetRole || !newPassword) {
        return sendError(res, badRequest("targetRole and newPassword are required"));
      }
      if (!isValidCompanyRole(targetRole)) {
        return sendError(res, badRequest("Invalid target role"));
      }
      if (newPassword.length < 4) {
        return sendError(res, badRequest("Password must be at least 4 characters"));
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await db.update(roleCredentials).set({
        passwordHash,
        lastPasswordPlain: newPassword,
        failedAttempts: 0,
        lockedUntil: null,
        updatedBy: currentRole,
        updatedAt: new Date(),
      }).where(eq(roleCredentials.role, targetRole));

      await db.insert(auditEvents).values({
        actorRole: currentRole,
        source: "SETTINGS",
        entityType: "role_credentials",
        entityId: targetRole,
        action: "password_changed",
        changesJson: { targetRole, changedBy: currentRole },
      });

      return res.json({ message: `Password updated for ${targetRole}` });
    } catch (err: any) {
      console.error("[ROLE-AUTH] Password change error:", err.message);
      logApiError("PATCH /api/role-auth/password", err);
      return sendError(res, serverError("Password change failed"));
    }
  });

  app.get("/api/role-auth/passwords", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return sendError(res, unauthorized("Authorization header required"));
      }
      const payload = verifyToken(authHeader.substring(7));
      if (!payload || (payload as any).role !== "COO_ADMIN") {
        return sendError(res, forbidden("Only COO_ADMIN can view passwords"));
      }

      const creds = await db.select({
        role: roleCredentials.role,
        lastPasswordPlain: roleCredentials.lastPasswordPlain,
        updatedBy: roleCredentials.updatedBy,
        updatedAt: roleCredentials.updatedAt,
      }).from(roleCredentials);

      return res.json(creds);
    } catch (err: any) {
      logApiError("GET /api/role-auth/passwords", err);
      return sendError(res, serverError("Failed to fetch passwords"));
    }
  });

}

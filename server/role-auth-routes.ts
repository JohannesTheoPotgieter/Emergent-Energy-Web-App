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
    if (process.env.NODE_ENV === "production") {
      throw new Error("Role credential seeding is disabled in production");
    }

    const existing = await db.select().from(roleCredentials);
    if (existing.length > 0) return;

    if (!process.env.SEED_COO_ADMIN_PASSWORD || !process.env.SEED_CEO_ADMIN_PASSWORD) {
      console.warn("[ROLE-AUTH] SEED_COO_ADMIN_PASSWORD / SEED_CEO_ADMIN_PASSWORD env vars not set — using fallback defaults. Set these before first deployment.");
    }
    const defaultPasswords: Record<string, string> = {
      COO_ADMIN: process.env.SEED_COO_ADMIN_PASSWORD || "emergent2026",
      CEO_ADMIN: process.env.SEED_CEO_ADMIN_PASSWORD || "emergent2026",
    };

    for (const role of COMPANY_ROLES) {
      const basePassword = defaultPasswords[role] || "emergent2026";
      const passwordHash = await bcrypt.hash(basePassword, 12);
      await db.insert(roleCredentials).values({
        role,
        passwordHash,
        failedAttempts: 0,
        updatedBy: "system",
      });
    }
    console.log("[ROLE-AUTH] Seeded role credentials from SEED_ADMIN_PASSWORD");
  } catch (err: unknown) {
    console.error("[ROLE-AUTH] Error seeding role credentials:", (err instanceof Error ? err.message : String(err)));
    throw err;
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
        await db.transaction(async (tx: any) => {
          await tx.update(roleCredentials).set(updates).where(eq(roleCredentials.id, cred.id));
          await tx.insert(auditEvents).values({
            actorRole: role,
            source: "UI",
            entityType: "role_auth",
            entityId: role,
            action: "login_failed",
            changesJson: { failedAttempts: newAttempts },
          });
        });

        return sendError(res, new ApiError(401, "INVALID_PASSWORD", "Invalid password"));
      }

      const label = COMPANY_ROLE_LABELS[role];
      const token = generateToken({
        userId: 0,
        email: `${role}@role.local`,
        name: label,
        role: role as any,
      });

      await db.transaction(async (tx: any) => {
        await tx.update(roleCredentials).set({
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        }).where(eq(roleCredentials.id, cred.id));
        await tx.insert(auditEvents).values({
          actorRole: role,
          source: "UI",
          entityType: "role_auth",
          entityId: role,
          action: "login_success",
        });
      });

      return res.json({
        token,
        role,
        label,
        isAdmin: (ADMIN_ROLES as readonly string[]).includes(role),
      });
    } catch (err: unknown) {
      console.error("[ROLE-AUTH] Login error:", (err instanceof Error ? err.message : String(err)));
      logApiError("POST /api/role-auth/login", err);
      return sendError(res, serverError("Login failed"));
    }
  });

  app.post("/api/role-auth/seed", requireCompanyRole("COO_ADMIN" as CompanyRole), async (_req: Request, res: Response) => {
    try {
      const existing = await db.select().from(roleCredentials);
      if (existing.length > 0) {
        return res.json({ message: "Role credentials already seeded", count: existing.length });
      }
      await seedRoleCredentials();
      return res.json({ message: "Role credentials seeded successfully", count: COMPANY_ROLES.length });
    } catch (err: unknown) {
      console.error("[ROLE-AUTH] Seed error:", (err instanceof Error ? err.message : String(err)));
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
    } catch (err: unknown) {
      logApiError("GET /api/role-auth/me", err);
      return sendError(res, serverError("Failed to get session"));
    }
  });

  app.get("/api/role-auth/roles", requireCompanyRole(...COMPANY_ROLES as unknown as CompanyRole[]), (_req: Request, res: Response) => {
    const roles = COMPANY_ROLES.map((role) => ({
      role,
      label: COMPANY_ROLE_LABELS[role],
      isAdmin: (ADMIN_ROLES as readonly string[]).includes(role),
    }));
    return res.json(roles);
  });

  // R-02 fix: Use standard requireCompanyRole middleware instead of manual token parsing
  app.patch("/api/role-auth/password", requireCompanyRole("COO_ADMIN" as CompanyRole), async (req: Request, res: Response) => {
    try {
      const currentRole = (req as any).companyRole as string;

      const { targetRole, newPassword } = req.body;
      if (!targetRole || !newPassword) {
        return sendError(res, badRequest("targetRole and newPassword are required"));
      }
      if (!isValidCompanyRole(targetRole)) {
        return sendError(res, badRequest("Invalid target role"));
      }
      if (newPassword.length < 8) {
        return sendError(res, badRequest("Password must be at least 8 characters"));
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await db.update(roleCredentials).set({
        passwordHash,
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
    } catch (err: unknown) {
      console.error("[ROLE-AUTH] Password change error:", (err instanceof Error ? err.message : String(err)));
      logApiError("PATCH /api/role-auth/password", err);
      return sendError(res, serverError("Password change failed"));
    }
  });

  // R-02 fix: Use standard requireCompanyRole middleware instead of manual token parsing
  app.get("/api/role-auth/passwords", requireCompanyRole("COO_ADMIN" as CompanyRole), async (req: Request, res: Response) => {
    try {
      const creds = await db.select({
        role: roleCredentials.role,
        updatedBy: roleCredentials.updatedBy,
        updatedAt: roleCredentials.updatedAt,
        passwordLastChangedAt: roleCredentials.updatedAt,
      }).from(roleCredentials);

      return res.json(creds);
    } catch (err: unknown) {
      logApiError("GET /api/role-auth/passwords", err);
      return sendError(res, serverError("Failed to fetch passwords"));
    }
  });

}

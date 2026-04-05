import type { Express } from "express";
import passport from "passport";
import crypto from "crypto";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { generateToken, verifyToken } from "../jwt";
import {
  clearRevokedSessionId,
  clearRevokedUserTokenVersionFloor,
  extractBearerToken,
  getEffectiveUser,
  getTokenVersionForUser,
  requireAuth,
  revokeSessionId,
  resolveAuthenticatedUser,
  revokeBearerToken,
  revokeUserTokens,
  setRevokedUserTokenVersionFloor,
} from "../auth-context";
import { ApiError, sendError, unauthorized, serverError, logApiError } from "../lib/api-error";

const MAX_SESSIONS_PER_USER = 3;

// Temporary store for one-time authorization codes (replaces token-in-URL pattern)
const authCodes = new Map<string, { token: string; user: object; expiresAt: number }>();

// Clean up expired codes every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of authCodes) {
    if (entry.expiresAt <= now) {
      authCodes.delete(code);
    }
  }
}, 60_000);

async function enforceSessionLimit(userId: number, currentSessionId: string, limit: number = MAX_SESSIONS_PER_USER): Promise<void> {
  try {
    // Use SQL JSON extraction to filter sessions by userId at the DB level (avoids race conditions)
    const userIdStr = String(userId);
    const result = await db.execute(
      sql`SELECT sid, expire FROM "session"
          WHERE expire > NOW()
            AND (sess::jsonb -> 'passport' ->> 'user') = ${userIdStr}
          ORDER BY expire DESC`
    );
    const rows = ((result as Record<string, unknown>).rows || result) as Record<string, unknown>[];
    if (rows.length <= limit) return;
    const toDelete = rows
      .filter((s) => s.sid !== currentSessionId)
      .slice(limit - 1);
    if (toDelete.length > 0) {
      const sids = toDelete.map((s) => s.sid as string);
      const sidParams = sids.map(s => sql`${s}`);
      await db.execute(sql`DELETE FROM "session" WHERE sid IN (${sql.join(sidParams, sql`, `)})`);
      console.log(`[SESSION] Cleaned ${toDelete.length} old session(s) for user ${userId}, keeping ${limit}`);
    }
  } catch (err) {
    console.error("[SESSION] Failed to enforce session limit:", err);
  }
}

export async function registerAuthRoutes(app: Express): Promise<void> {
  app.get("/api/auth/status", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const user = await resolveAuthenticatedUser(req);
      const sessionAuth = Boolean(req.isAuthenticated?.());

      const response: Record<string, unknown> = {
        authenticated: Boolean(user),
        user: user
          ? {
              email: user.email,
              role: user.role,
            }
          : null,
        hasSession: sessionAuth,
        hasUser: Boolean(user),
        hasCookie: Boolean(req.headers.cookie),
        hasAuthHeader: Boolean(authHeader),
        jwtValid: Boolean(authHeader && authHeader.startsWith("Bearer ") && user),
        sessionAuth,
      };

      // Only expose infrastructure details in non-production environments
      if (process.env.NODE_ENV !== "production") {
        const { dbMode } = await import("../db");
        const { getDbConfigStatus } = await import("../db-config");
        const dbStatus = getDbConfigStatus();
        response.dbMode = dbMode;
        response.dbConnected = dbStatus.connected;
      }

      res.json(response);
    } catch (error) {
      logApiError("GET /api/auth/status", error);
      return sendError(res, serverError("Failed to get auth status"));
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    const { dbMode } = await import("../db");

    if (process.env.NODE_ENV !== "development") {
      return sendError(
        res,
        new ApiError(403, "PASSWORD_LOGIN_DISABLED", "Password login is only available in development mode. Please use Microsoft 365 sign-in."),
      );
    }

    passport.authenticate("local", (err: Error | null, user: { id: number; email: string; name: string; role: string } | false, info: { message: string }) => {
      if (err) {
        logApiError("POST /api/auth/login", err);

        if (err.message && (err.message.includes("ENOTFOUND") || err.message.includes("ECONNREFUSED"))) {
          return sendError(
            res,
            new ApiError(503, "DB_CONNECTION_ERROR", "Database connection unavailable. Please check the database configuration.", {
              dbMode,
            }),
          );
        }

        return sendError(res, new ApiError(500, "LOGIN_ERROR", "An error occurred during login", { dbMode }));
      }

      if (!user) {
        console.log("[LOGIN] Failed login attempt:", req.body?.username, "- Reason:", info?.message);
        return sendError(res, unauthorized(info?.message || "Invalid username or password"));
      }

      req.logIn(user, async (loginError) => {
        if (loginError) {
          logApiError("POST /api/auth/login session", loginError);
          return sendError(res, new ApiError(500, "SESSION_ERROR", "Failed to establish session", { dbMode }));
        }

        try {
          await enforceSessionLimit(user.id, req.sessionID, 3);
          const tokenVersion = await getTokenVersionForUser(user.id);
          const token = generateToken({
            userId: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            tokenVersion,
          });
          clearRevokedSessionId(req.sessionID);
          clearRevokedUserTokenVersionFloor(user.id);

          res.json({
            message: "Login successful",
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
            token,
          });
        } catch (tokenError) {
          logApiError("POST /api/auth/login token", tokenError);
          sendError(res, new ApiError(500, "TOKEN_ERROR", "Failed to create auth token", { dbMode }));
        }
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    const currentUser = getEffectiveUser(req);
    const bearerToken = extractBearerToken(req);
    const bearerPayload = bearerToken ? verifyToken(bearerToken) : null;
    const sessionId = req.sessionID;

    try {
      await new Promise<void>((resolve, reject) => {
        req.logout((err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        if (!req.session) {
          resolve();
          return;
        }

        req.session.destroy((err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });
      });

      if (currentUser?.id) {
        const nextTokenVersion = await revokeUserTokens(currentUser.id);
        const bearerTokenVersion = typeof bearerPayload?.tokenVersion === "number" ? bearerPayload.tokenVersion : 0;
        setRevokedUserTokenVersionFloor(currentUser.id, Math.max(nextTokenVersion, bearerTokenVersion + 1));
      }
      if (bearerToken) {
        revokeBearerToken(bearerToken);
      }
      revokeSessionId(sessionId);

      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      logApiError("POST /api/auth/logout", error);
      sendError(res, new ApiError(500, "LOGOUT_FAILED", "Logout failed"));
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      return sendError(res, unauthorized("Not authenticated"));
    }

    // Post-migration: enrich with party identity from promoted schema
    let partyIdentity: { partyId: number | null; userAccountId: number | null; partyName: string | null } | null = null;
    try {
      const { resolveUserPartyIdentity } = await import("../services/auth-party-resolver");
      const identity = await resolveUserPartyIdentity(user.id);
      if (identity) {
        partyIdentity = {
          partyId: identity.partyId,
          userAccountId: identity.userAccountId,
          partyName: identity.partyName,
        };
      }
    } catch {
      // Promoted schema may not be available — fail silently
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        ...partyIdentity && { partyId: partyIdentity.partyId, userAccountId: partyIdentity.userAccountId, partyName: partyIdentity.partyName },
      },
    });
  });

  if (process.env.NODE_ENV === "development") {
    app.get("/api/auth/dev-login", async (_req, res) => {
      try {
        const [adminUser] = await db.select().from(users).where(eq(users.username, "johannes"));
        if (!adminUser) return res.status(404).send("Dev user not found");
        const tokenVersion = await getTokenVersionForUser(adminUser.id);
        const token = generateToken({
          userId: adminUser.id,
          email: adminUser.email || "",
          name: adminUser.name || "",
          role: adminUser.role || "",
          tokenVersion,
        });
        // Use authorization code pattern instead of injecting token directly into HTML (prevents XSS)
        const authCode = crypto.randomBytes(32).toString("hex");
        authCodes.set(authCode, { token, user: { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: adminUser.role }, expiresAt: Date.now() + 60_000 });
        res.redirect(`/auth/ms-callback?code=${encodeURIComponent(authCode)}`);
      } catch (e) {
        res.status(500).send("Dev login failed");
      }
    });
  }

  const msAuth = await import("../microsoft-auth");

  app.get("/api/auth/microsoft/config", (_req, res) => {
    res.json({ enabled: msAuth.isMicrosoftAuthConfigured() });
  });

  app.get("/api/auth/login-modes", (_req, res) => {
    const passwordLoginEnabled = process.env.NODE_ENV === "development";
    res.json({ passwordLoginEnabled });
  });

  app.get("/api/auth/microsoft", async (_req, res) => {
    try {
      if (!msAuth.isMicrosoftAuthConfigured()) {
        return sendError(res, new ApiError(503, "MS_AUTH_NOT_CONFIGURED", "Microsoft authentication is not configured"));
      }
      const authUrl = await msAuth.getAuthorizationUrl();
      res.redirect(authUrl);
    } catch (err) {
      console.error("[MS Auth] Error generating auth URL:", err);
      res.redirect("/auth/login?error=ms_auth_failed");
    }
  });

  app.get("/api/auth/microsoft/callback", async (req, res) => {
    try {
      const { code, error: msError } = req.query;
      if (msError || !code) {
        return res.redirect("/auth/login?error=ms_auth_denied");
      }

      const result = await msAuth.handleCallback(code as string);
      if (!result.msProfile) {
        return res.redirect("/auth/login?error=ms_profile_failed");
      }

      const msEmail = result.msProfile.mail?.toLowerCase() || result.msProfile.userPrincipalName?.toLowerCase();
      const msId = result.msProfile.id;
      if (!msEmail) {
        return res.redirect("/auth/login?error=ms_no_email");
      }

      let matchedUser = await db.select().from(users).where(eq(users.microsoft_id, msId)).limit(1);
      if (matchedUser.length === 0) {
        matchedUser = await db.select().from(users).where(sql`LOWER(${users.email}) = ${msEmail}`).limit(1);
        if (matchedUser.length === 0) {
          const emailPrefix = msEmail.split("@")[0];
          matchedUser = await db.select().from(users).where(sql`LOWER(${users.username}) = ${emailPrefix}`).limit(1);
        }
        if (matchedUser.length > 0) {
          await db.update(users).set({ microsoft_id: msId }).where(eq(users.id, matchedUser[0].id));
        }
      }

      if (matchedUser.length === 0) {
        return res.redirect(`/auth/login?error=ms_no_account&email=${encodeURIComponent(msEmail)}`);
      }

      const dbUser = matchedUser[0];
      const sessionUser = { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role };

      req.logIn(sessionUser, async (loginError) => {
        if (loginError) {
          return res.redirect("/auth/login?error=ms_session_failed");
        }

        try {
          await enforceSessionLimit(dbUser.id, req.sessionID, 3);
          const tokenVersion = await getTokenVersionForUser(dbUser.id);
          const token = generateToken({
            userId: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role,
            tokenVersion,
          });
          const authCode = crypto.randomBytes(32).toString("hex");
          authCodes.set(authCode, { token, user: sessionUser, expiresAt: Date.now() + 60_000 });
          res.redirect(`/auth/ms-callback?code=${encodeURIComponent(authCode)}`);
        } catch (tokenError) {
          logApiError("GET /api/auth/microsoft/callback token", tokenError);
          res.redirect("/auth/login?error=ms_auth_failed");
        }
      });
    } catch (error) {
      logApiError("GET /api/auth/microsoft/callback", error);
      return res.redirect("/auth/login?error=ms_auth_failed");
    }
  });

  app.post("/api/auth/exchange-code", (req, res) => {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return sendError(res, new ApiError(400, "INVALID_CODE", "Authorization code is required"));
    }

    const entry = authCodes.get(code);
    if (!entry || entry.expiresAt <= Date.now()) {
      authCodes.delete(code);
      return sendError(res, unauthorized("Invalid or expired authorization code"));
    }

    authCodes.delete(code);
    res.json({ token: entry.token, user: entry.user });
  });

  app.get("/api/pm-assignable-users", requireAuth, async (_req, res) => {
    try {
      const pmUsers = await db.select({ id: users.id, name: users.name, username: users.username, role: users.role }).from(users).where(eq(users.role, "PROJECT_MANAGER_SITE"));
      res.json(pmUsers);
    } catch {
      res.status(500).json({ error: "Failed to fetch PM users" });
    }
  });

  app.get("/api/pd-assignable-users", requireAuth, async (_req, res) => {
    try {
      const pdUsers = await db.select({ id: users.id, name: users.name, username: users.username, role: users.role, microsoft_id: users.microsoft_id }).from(users).where(eq(users.role, "PROJECT_DEVELOPER"));
      const filtered = pdUsers.filter((u: any) => u.microsoft_id != null && u.microsoft_id !== "");
      res.json(filtered.map(({ microsoft_id: _microsoftId, ...rest }: any) => rest));
    } catch {
      res.status(500).json({ error: "Failed to fetch PD users" });
    }
  });
}

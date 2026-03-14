import type { Express, RequestHandler } from "express";
import passport from "passport";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { generateToken, verifyToken } from "../jwt";
import { ApiError, sendError, unauthorized, serverError, logApiError } from "../lib/api-error";

export async function registerAuthRoutes(app: Express, requireAuth: RequestHandler): Promise<void> {
  app.get("/api/auth/status", async (req, res) => {
    try {
      const { dbMode } = await import("../db");
      const { getDbConfigStatus } = await import("../db-config");
      const dbStatus = getDbConfigStatus();

      res.json({
        authenticated: req.isAuthenticated(),
        user: req.user
          ? {
              email: req.user.email,
              role: req.user.role,
            }
          : null,
        dbMode,
        dbConnected: dbStatus.connected,
      });
    } catch (error) {
      logApiError("GET /api/auth/status", error);
      return sendError(res, serverError("Failed to get auth status"));
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    const { dbMode } = await import("../db");

    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string }) => {
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

      const ALLOWED_PASSWORD_LOGIN_USERNAMES = ["johannes"];
      if (!ALLOWED_PASSWORD_LOGIN_USERNAMES.includes((user.email?.split("@")[0] || "").toLowerCase()) && user.id !== 31) {
        console.log("[LOGIN] Password login blocked for non-allowed user:", user.email, "role:", user.role);
        return sendError(
          res,
          new ApiError(403, "PASSWORD_LOGIN_RESTRICTED", "Password login is not available for this account. Please use Microsoft 365 sign-in."),
        );
      }

      req.logIn(user, (loginError) => {
        if (loginError) {
          logApiError("POST /api/auth/login session", loginError);
          return sendError(res, new ApiError(500, "SESSION_ERROR", "Failed to establish session", { dbMode }));
        }

        const token = generateToken({ userId: user.id, email: user.email, name: user.name, role: user.role });

        return res.json({
          message: "Login successful",
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          token,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return sendError(res, new ApiError(500, "LOGOUT_FAILED", "Logout failed"));
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      return res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role } });
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload) {
        return res.json({
          user: { id: payload.userId, email: payload.email, name: payload.name, role: payload.role },
        });
      }
    }

    return sendError(res, unauthorized("Not authenticated"));
  });

  if (process.env.NODE_ENV === "development") {
    app.get("/api/auth/dev-login", async (_req, res) => {
      try {
        const [adminUser] = await db.select().from(users).where(eq(users.username, "johannes"));
        if (!adminUser) return res.status(404).send("Dev user not found");
        const token = generateToken({ userId: adminUser.id, email: adminUser.email || "", name: adminUser.name || "", role: adminUser.role || "" });
        res.send(`<!DOCTYPE html><html><body><script>localStorage.setItem('auth_token','${token}');window.location.href='/dashboard';</script></body></html>`);
      } catch (e) {
        res.status(500).send("Dev login failed");
      }
    });
  }

  const msAuth = await import("../microsoft-auth");

  app.get("/api/auth/microsoft/config", (_req, res) => {
    res.json({ enabled: msAuth.isMicrosoftAuthConfigured() });
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
      req.logIn(sessionUser, (loginError) => {
        if (loginError) {
          return res.redirect("/auth/login?error=ms_session_failed");
        }

        const token = generateToken({ userId: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role });
        return res.redirect(`/auth/ms-callback?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(sessionUser))}`);
      });
    } catch (error) {
      logApiError("GET /api/auth/microsoft/callback", error);
      return res.redirect("/auth/login?error=ms_auth_failed");
    }
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
      const filtered = pdUsers.filter((u) => u.microsoft_id != null && u.microsoft_id !== "");
      res.json(filtered.map(({ microsoft_id: _microsoftId, ...rest }) => rest));
    } catch {
      res.status(500).json({ error: "Failed to fetch PD users" });
    }
  });
}

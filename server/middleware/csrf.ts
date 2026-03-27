import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXEMPT_PATHS = new Set(["/api/auth/login", "/api/auth/microsoft"]);

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.substring(0, idx).trim();
    const value = pair.substring(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * Double-submit cookie CSRF protection.
 *
 * - Sets a random CSRF token in a non-httpOnly cookie on every response.
 * - For state-changing requests (POST/PUT/PATCH/DELETE), validates that the
 *   X-CSRF-Token header matches the csrf-token cookie.
 * - Skips validation for Bearer-token-only requests (not vulnerable to CSRF)
 *   and for exempt auth routes.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);

  // Generate / refresh the CSRF cookie on every response
  let token = cookies[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
  }
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  // Only validate state-changing methods
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return next();
  }

  // Skip exempt paths
  if (EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  // Skip if the request uses only a Bearer token (no session cookie).
  // Bearer-token requests are not vulnerable to CSRF because the browser
  // does not attach the Authorization header automatically.
  const hasBearer = req.headers.authorization?.startsWith("Bearer ");
  const hasSessionCookie = !!cookies["connect.sid"];
  if (hasBearer && !hasSessionCookie) {
    return next();
  }

  // Validate: header must match cookie
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;
  if (!headerToken || headerToken !== token) {
    return res.status(403).json({ message: "Invalid or missing CSRF token" });
  }

  next();
}

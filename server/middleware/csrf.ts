import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { CSRF_PROTECTED_METHODS, isCsrfExemptPath } from "./csrf-config";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

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
 *   and for exempt paths defined in csrf-config.ts.
 *
 * See csrf-config.ts for the full exemption documentation and categories.
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
  if (!CSRF_PROTECTED_METHODS.has(req.method)) {
    return next();
  }

  // Skip exempt paths (auth bootstrap, webhooks, health checks)
  if (isCsrfExemptPath(req.path)) {
    return next();
  }

  // API/workflow quality gates use direct fetch clients that do not behave
  // like the browser bridge. Keep the bypass opt-in and non-production only.
  if (process.env.NODE_ENV !== "production" && process.env.API_TEST_MODE === "true") {
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

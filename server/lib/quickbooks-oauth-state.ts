import crypto from "crypto";
import type { Request, Response } from "express";

/**
 * Cross-site-callback-safe CSRF state for the QuickBooks OAuth flow.
 *
 * Intuit returns from consent as a cross-site, top-level GET navigation to our
 * callback. The express-session cookie is SameSite=Lax, which browsers do not
 * reliably attach on that cross-site callback — so the session-stored `qbState`
 * can be missing at the callback even though it was saved at auth-start,
 * surfacing to the operator as "Invalid CSRF state".
 *
 * We therefore ALSO stash the state in a dedicated, short-lived cookie that is
 * SameSite=None;Secure (so it IS sent on the cross-site callback). The callback
 * accepts a match on EITHER the cookie or the session — both are server-issued,
 * browser-bound secrets, so double-submit CSRF protection is preserved.
 */

export const QB_OAUTH_STATE_COOKIE = "qb_oauth_state";

/** Stash the OAuth CSRF state in the cross-site-safe cookie at auth-start. */
export function setQbOAuthStateCookie(res: Response, state: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(QB_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    // SameSite=None requires Secure, so only use it on production HTTPS; local
    // HTTP dev falls back to Lax (OAuth runs against mock connectors there).
    sameSite: isProd ? "none" : "lax",
    path: "/api/quickbooks",
    maxAge: 10 * 60 * 1000, // 10 minutes — the OAuth round-trip is short-lived.
  });
}

/** Clear the OAuth state cookie (one-shot: after success or on mismatch). */
export function clearQbOAuthStateCookie(res: Response): void {
  res.clearCookie(QB_OAUTH_STATE_COOKIE, { path: "/api/quickbooks" });
}

/** Read the OAuth state cookie off the raw Cookie header (no cookie-parser dep). */
export function readQbOAuthStateCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() === QB_OAUTH_STATE_COOKIE) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Constant-time equality for two non-empty state strings. */
export function statesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

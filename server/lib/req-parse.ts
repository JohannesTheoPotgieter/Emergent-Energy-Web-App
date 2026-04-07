/**
 * Typed request parameter helpers.
 *
 * Express types `req.query.*` as `string | string[] | ParsedQs | ...` and
 * `req.params.*` as `string`.  Routes that read these values almost always
 * need them as a plain `string` or parsed `number`.  Instead of scattering
 * `as string` casts or `parseInt(String(…))` across 300+ call sites, use
 * these helpers to parse at the request boundary with clear, safe semantics.
 *
 * Usage:
 *   const page = queryInt(req, "page", 1);          // number, default 1
 *   const filter = queryStr(req, "status");          // string | undefined
 *   const name = queryStr(req, "name", "all");       // string, default "all"
 *   const id = paramInt(req, "id");                  // number | null
 *   const code = paramStr(req, "code");              // string
 */

import type { Request } from "express";

/** Read a query-string value as a trimmed string, or return the default. */
export function queryStr(req: Request, key: string): string | undefined;
export function queryStr(req: Request, key: string, fallback: string): string;
export function queryStr(req: Request, key: string, fallback?: string): string | undefined {
  const raw = req.query[key];
  if (raw == null) return fallback;
  const value = (Array.isArray(raw) ? raw[0] : raw) as string;
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

/** Read a query-string value as an integer, or return the default. */
export function queryInt(req: Request, key: string): number | undefined;
export function queryInt(req: Request, key: string, fallback: number): number;
export function queryInt(req: Request, key: string, fallback?: number): number | undefined {
  const s = queryStr(req, key);
  if (s == null) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Read a route param as a trimmed string (always defined if the route matched). */
export function paramStr(req: Request, key: string): string {
  return String(req.params[key] ?? "").trim();
}

/** Read a route param as an integer, or null if not parseable. */
export function paramInt(req: Request, key: string): number | null {
  const n = parseInt(paramStr(req, key), 10);
  return Number.isFinite(n) ? n : null;
}

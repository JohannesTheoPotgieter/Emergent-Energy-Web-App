import type { NextFunction, Request, Response } from "express";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db, dbMode } from "./db";
import { verifyToken } from "./jwt";

export type AuthenticatedUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  tokenVersion?: number;
};

const TOKEN_VERSION_COLUMN_CACHE_MS = 5 * 60_000;
const REVOKED_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const REVOKED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let tokenVersionColumnState: { checkedAt: number; exists: boolean } | null = null;
const revokedBearerTokens = new Map<string, number>();
const revokedSessionIds = new Map<string, number>();
const revokedUserTokenVersionFloors = new Map<number, number>();

type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};

type SqliteClient = {
  prepare: (query: string) => SqliteStatement;
};

const RESOLVED_AUTH_USER = Symbol("resolvedAuthUser");
const HAS_RESOLVED_AUTH = Symbol("hasResolvedAuth");

type RequestWithResolvedAuth = Request & {
  [RESOLVED_AUTH_USER]?: AuthenticatedUser | null;
  [HAS_RESOLVED_AUTH]?: boolean;
};

function authDebug(...args: unknown[]): void {
  if (process.env.AUTH_DEBUG === "true") {
    console.log("[AUTH_DEBUG]", ...args);
  }
}

function cleanupRevokedBearerTokens(now = Date.now()): void {
  for (const [digest, expiresAt] of revokedBearerTokens.entries()) {
    if (expiresAt <= now) {
      revokedBearerTokens.delete(digest);
    }
  }
}

function cleanupRevokedSessionIds(now = Date.now()): void {
  for (const [sessionId, expiresAt] of revokedSessionIds.entries()) {
    if (expiresAt <= now) {
      revokedSessionIds.delete(sessionId);
    }
  }
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.substring(7);
}

export function revokeBearerToken(token: string): void {
  cleanupRevokedBearerTokens();
  const digest = digestToken(token);
  revokedBearerTokens.set(digest, Date.now() + REVOKED_TOKEN_TTL_MS);
  authDebug("revokeBearerToken", { digest, revokedCount: revokedBearerTokens.size });
}

export function revokeSessionId(sessionId: string | null | undefined): void {
  if (!sessionId) {
    return;
  }

  cleanupRevokedSessionIds();
  revokedSessionIds.set(sessionId, Date.now() + REVOKED_SESSION_TTL_MS);
  authDebug("revokeSessionId", { sessionId });
}

export function clearRevokedSessionId(sessionId: string | null | undefined): void {
  if (!sessionId) {
    return;
  }

  revokedSessionIds.delete(sessionId);
}

export function setRevokedUserTokenVersionFloor(userId: number, floor: number): void {
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(floor)) {
    return;
  }

  const currentFloor = revokedUserTokenVersionFloors.get(userId) ?? 0;
  revokedUserTokenVersionFloors.set(userId, Math.max(currentFloor, floor));
  authDebug("setRevokedUserTokenVersionFloor", { userId, floor, currentFloor });
}

export function clearRevokedUserTokenVersionFloor(userId: number): void {
  if (!Number.isFinite(userId) || userId <= 0) {
    return;
  }

  revokedUserTokenVersionFloors.delete(userId);
}

function isBearerTokenRevoked(token: string): boolean {
  cleanupRevokedBearerTokens();
  const digest = digestToken(token);
  const expiresAt = revokedBearerTokens.get(digest);
  const revoked = typeof expiresAt === "number" && expiresAt > Date.now();
  authDebug("isBearerTokenRevoked", { digest, revoked });
  return revoked;
}

function isSessionRevoked(req: Request): boolean {
  cleanupRevokedSessionIds();
  const sessionId = req.sessionID;
  return typeof sessionId === "string" && revokedSessionIds.has(sessionId);
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: Record<string, unknown>[] }).rows;
    return Array.isArray(rows) ? rows : [];
  }

  return [];
}

function getSqliteClient(): SqliteClient | null {
  if (dbMode !== "sqlite") {
    return null;
  }

  const client = (db as { $client?: SqliteClient }).$client;
  if (client && typeof client.prepare === "function") {
    return client;
  }

  return null;
}

function getCachedResolvedAuthUser(req: Request): AuthenticatedUser | null | undefined {
  const request = req as RequestWithResolvedAuth;
  if (!request[HAS_RESOLVED_AUTH]) {
    return undefined;
  }

  return request[RESOLVED_AUTH_USER] ?? null;
}

function cacheResolvedAuthUser(req: Request, user: AuthenticatedUser | null): void {
  const request = req as RequestWithResolvedAuth;
  request[HAS_RESOLVED_AUTH] = true;
  request[RESOLVED_AUTH_USER] = user;
}

async function queryRows(query: unknown): Promise<Record<string, unknown>[]> {
  if (typeof db.execute === "function") {
    return rowsFromResult(await db.execute(query));
  }

  if (typeof db.all === "function") {
    const rows = await db.all(query as any);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }

  if (typeof db.get === "function") {
    const row = await db.get(query as any);
    return row ? [row as Record<string, unknown>] : [];
  }

  return [];
}

async function runStatement(query: unknown): Promise<unknown> {
  if (typeof db.execute === "function") {
    return db.execute(query);
  }

  if (typeof db.run === "function") {
    return db.run(query as any);
  }

  return null;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function normalizeUser(row: Record<string, unknown> | null | undefined): AuthenticatedUser | null {
  if (!row) {
    return null;
  }

  const id = Number(row.id ?? 0);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    email: String(row.email ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
    tokenVersion: Number(row.token_version ?? row.tokenVersion ?? 0),
  };
}

function syncLegacyUser(req: Request, user: AuthenticatedUser | null): void {
  const authRequest = req as Request & { user?: AuthenticatedUser | undefined };

  if (user) {
    authRequest.user = user;
    (req as any).user = user;
    return;
  }

  authRequest.user = undefined;
  (req as any).user = undefined;
  delete authRequest.user;
  delete (req as any).user;
}

async function hasTokenVersionColumn(): Promise<boolean> {
  const now = Date.now();
  if (tokenVersionColumnState && now - tokenVersionColumnState.checkedAt < TOKEN_VERSION_COLUMN_CACHE_MS) {
    return tokenVersionColumnState.exists;
  }

  try {
    let exists = false;

    if (dbMode === "sqlite") {
      const sqliteClient = getSqliteClient();
      if (sqliteClient) {
        const rows = sqliteClient.prepare("PRAGMA table_info(users)").all() as Array<{ name?: string }>;
        exists = rows.some((row) => String(row.name ?? "") === "token_version");
      } else {
        const rows = await queryRows(sql.raw("PRAGMA table_info(users)"));
        exists = rows.some((row) => String(row.name ?? "") === "token_version");
      }
    } else {
      const rows = await queryRows(
        sql`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'users'
              AND column_name = 'token_version'
          ) AS present
        `,
      );
      exists = normalizeBoolean(rows[0]?.present);
    }

    tokenVersionColumnState = { checkedAt: now, exists };
    return exists;
  } catch {
    tokenVersionColumnState = { checkedAt: now, exists: false };
    return false;
  }
}

async function fetchUserById(userId: number): Promise<AuthenticatedUser | null> {
  const tokenVersionEnabled = await hasTokenVersionColumn();
  const sqliteClient = getSqliteClient();
  if (sqliteClient) {
    const query = tokenVersionEnabled
      ? "SELECT id, email, name, role, COALESCE(token_version, 0) AS token_version FROM users WHERE id = ? LIMIT 1"
      : "SELECT id, email, name, role, 0 AS token_version FROM users WHERE id = ? LIMIT 1";
    const row = sqliteClient.prepare(query).get(userId) as Record<string, unknown> | undefined;
    return normalizeUser(row);
  }

  const query = tokenVersionEnabled
    ? sql`
        SELECT id, email, name, role, COALESCE(token_version, 0) AS token_version
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `
    : sql`
        SELECT id, email, name, role, 0 AS token_version
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `;

  const [row] = await queryRows(query);
  return normalizeUser(row);
}

async function resolveBearerUser(req: Request): Promise<AuthenticatedUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  if (isBearerTokenRevoked(token)) {
    return null;
  }

  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  const payloadTokenVersion = typeof payload.tokenVersion === "number" ? payload.tokenVersion : 0;
  const revokedFloor = revokedUserTokenVersionFloors.get(payload.userId);
  if (typeof revokedFloor === "number" && payloadTokenVersion < revokedFloor) {
    authDebug("resolveBearerUser.revokedFloor", { userId: payload.userId, payloadTokenVersion, revokedFloor });
    return null;
  }

  const user = await fetchUserById(payload.userId);
  if (!user) {
    return null;
  }

  if (await hasTokenVersionColumn()) {
    authDebug("resolveBearerUser.tokenVersion", {
      userId: payload.userId,
      payloadTokenVersion,
      userTokenVersion: user.tokenVersion ?? 0,
    });
    if (payloadTokenVersion !== (user.tokenVersion ?? 0)) {
      return null;
    }
  }

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function getEffectiveUser(req: Request): AuthenticatedUser | null {
  return (req.user as AuthenticatedUser | undefined) ?? ((req as any).user as AuthenticatedUser | undefined) ?? null;
}

export async function resolveAuthenticatedUser(req: Request): Promise<AuthenticatedUser | null> {
  const cachedUser = getCachedResolvedAuthUser(req);
  if (cachedUser !== undefined) {
    syncLegacyUser(req, cachedUser);
    authDebug("resolveAuthenticatedUser.cached", {
      path: req.path,
      userId: cachedUser?.id ?? null,
    });
    return cachedUser;
  }

  authDebug("resolveAuthenticatedUser.start", {
    path: req.path,
    sessionId: req.sessionID,
    sessionAuth: Boolean(req.isAuthenticated?.()),
    hasReqUser: Boolean(req.user),
    hasLegacyUser: Boolean((req as any).user),
    hasAuthHeader: Boolean(req.headers.authorization),
  });

  if (isSessionRevoked(req)) {
    syncLegacyUser(req, null);
    cacheResolvedAuthUser(req, null);
    authDebug("resolveAuthenticatedUser.sessionRevoked", { path: req.path, sessionId: req.sessionID });
    return null;
  }

  const existingUser = getEffectiveUser(req);
  if (existingUser) {
    syncLegacyUser(req, existingUser);
    cacheResolvedAuthUser(req, existingUser);
    authDebug("resolveAuthenticatedUser.existingUser", { path: req.path, userId: existingUser.id });
    return existingUser;
  }

  if (req.isAuthenticated?.() && req.user) {
    const sessionUser = req.user as AuthenticatedUser;
    syncLegacyUser(req, sessionUser);
    cacheResolvedAuthUser(req, sessionUser);
    authDebug("resolveAuthenticatedUser.sessionUser", { path: req.path, userId: sessionUser.id });
    return sessionUser;
  }

  const bearerUser = await resolveBearerUser(req);
  if (bearerUser) {
    syncLegacyUser(req, bearerUser);
    cacheResolvedAuthUser(req, bearerUser);
    authDebug("resolveAuthenticatedUser.bearerUser", { path: req.path, userId: bearerUser.id });
    return bearerUser;
  }

  syncLegacyUser(req, null);
  cacheResolvedAuthUser(req, null);
  authDebug("resolveAuthenticatedUser.none", { path: req.path });
  return null;
}

export async function jwtAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await resolveAuthenticatedUser(req);
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (user) {
      next();
      return;
    }

    res.status(401).json({ error: "auth_required", message: "Authentication required", code: "AUTH_REQUIRED" });
  } catch (error) {
    next(error);
  }
}

export async function getTokenVersionForUser(userId: number): Promise<number> {
  const user = await fetchUserById(userId);
  return user?.tokenVersion ?? 0;
}

export async function revokeUserTokens(userId: number): Promise<number> {
  if (!(await hasTokenVersionColumn())) {
    return 0;
  }

  if (dbMode === "sqlite") {
    const sqliteClient = getSqliteClient();
    if (sqliteClient) {
      sqliteClient.prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?").run(userId);
    } else {
      await runStatement(sql`
        UPDATE users
        SET token_version = COALESCE(token_version, 0) + 1
        WHERE id = ${userId}
      `);
    }
    return getTokenVersionForUser(userId);
  }

  const [row] = await queryRows(sql`
    UPDATE users
    SET token_version = COALESCE(token_version, 0) + 1
    WHERE id = ${userId}
    RETURNING token_version
  `);

  return Number(row?.token_version ?? row?.tokenVersion ?? 0);
}

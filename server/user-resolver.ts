import { db } from "./db";
import { users } from "@shared/schema";
import { asc, isNotNull } from "drizzle-orm";

export interface ResolvedUser {
  id: number;
  name: string;
  username: string;
  role: string;
  microsoft_id?: string | null;
}

let cachedUsers: ResolvedUser[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

export async function getAllUsers(): Promise<ResolvedUser[]> {
  if (Date.now() - cacheTimestamp < CACHE_TTL && cachedUsers.length > 0) {
    return cachedUsers;
  }
  const rows = await db.select({
    id: users.id,
    name: users.name,
    username: users.username,
    role: users.role,
    microsoft_id: users.microsoft_id,
  }).from(users).orderBy(asc(users.name));
  cachedUsers = rows;
  cacheTimestamp = Date.now();
  return cachedUsers;
}

export async function getAssignableUsers(): Promise<ResolvedUser[]> {
  const allUsers = await getAllUsers();
  return allUsers.filter(u => u.microsoft_id != null && u.microsoft_id !== "");
}

export function invalidateUserCache() {
  cacheTimestamp = 0;
}

export async function resolveNameToUserId(name: string): Promise<number | null> {
  if (!name || !name.trim()) return null;
  const allUsers = await getAllUsers();
  const n = name.trim().toLowerCase();

  for (const u of allUsers) {
    if (u.username.toLowerCase() === n) return u.id;
    if (u.name.toLowerCase() === n) return u.id;
  }

  for (const u of allUsers) {
    const firstName = u.name.split(" ")[0].toLowerCase();
    if (firstName === n) return u.id;
  }

  for (const u of allUsers) {
    if (u.name.toLowerCase().includes(n) || n.includes(u.name.toLowerCase())) return u.id;
  }

  return null;
}

export async function resolveNameToUser(name: string): Promise<ResolvedUser | null> {
  const userId = await resolveNameToUserId(name);
  if (!userId) return null;
  const allUsers = await getAllUsers();
  return allUsers.find(u => u.id === userId) || null;
}

export async function resolveNamesToUserIds(names: string[]): Promise<(number | null)[]> {
  return Promise.all(names.map(n => resolveNameToUserId(n)));
}

export async function buildUserMap(): Promise<Map<number, ResolvedUser>> {
  const allUsers = await getAllUsers();
  const map = new Map<number, ResolvedUser>();
  for (const u of allUsers) {
    map.set(u.id, u);
  }
  return map;
}

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchTextNameToUser(textName: string, allUsers: ResolvedUser[]): ResolvedUser | undefined {
  const n = normalizeForMatch(textName);
  if (!n) return undefined;

  let found: ResolvedUser | undefined;
  found = allUsers.find(u => normalizeForMatch(u.name) === n || u.username.toLowerCase() === n);
  if (found) return found;

  found = allUsers.find(u => normalizeForMatch(u.name).split(" ")[0] === n);
  if (found) return found;

  const parts = n.split(" ");
  if (parts.length >= 2) {
    const lastName = parts[parts.length - 1];
    found = allUsers.find(u => {
      const uParts = normalizeForMatch(u.name).split(" ");
      return uParts.length >= 2 && uParts[uParts.length - 1] === lastName && uParts[0] === parts[0];
    });
    if (found) return found;
  }

  if (n.includes(",")) {
    const flipped = n.split(",").map(s => s.trim()).reverse().join(" ");
    found = allUsers.find(u => normalizeForMatch(u.name) === flipped);
    if (found) return found;
  }

  found = allUsers.find(u => {
    const uParts = normalizeForMatch(u.name).split(" ");
    return uParts.length >= 2 && uParts[uParts.length - 1] === n;
  });
  if (found) return found;

  if (n.length >= 4) {
    found = allUsers.find(u => normalizeForMatch(u.name).startsWith(n) || n.startsWith(normalizeForMatch(u.name)));
    if (found) return found;

    found = allUsers.find(u => normalizeForMatch(u.name).includes(n) || n.includes(normalizeForMatch(u.name)));
  }

  return found;
}

export function mergeResolvedWithTextNames(
  resolvedFromIds: ResolvedUser[],
  textNames: string[] | null | undefined,
  userMap: Map<number, ResolvedUser>,
): ResolvedUser[] {
  if (!textNames || textNames.length === 0) return resolvedFromIds;
  const resolvedIds = new Set(resolvedFromIds.map(u => u.id));
  const allUsers = [...userMap.values()];
  const merged = [...resolvedFromIds];
  for (const name of textNames) {
    if (!name || !name.trim()) continue;
    const n = normalizeForMatch(name);
    const alreadyCovered = merged.some(u => {
      const un = normalizeForMatch(u.name);
      if (un === n) return true;
      if (un.split(" ")[0] === n) return true;
      const uParts = un.split(" ");
      if (uParts.length >= 2 && uParts[uParts.length - 1] === n) return true;
      if (n.length >= 4 && (un.startsWith(n) || n.startsWith(un))) return true;
      return false;
    });
    if (alreadyCovered) continue;
    const found = matchTextNameToUser(name, allUsers);
    if (found && !resolvedIds.has(found.id)) {
      merged.push(found);
      resolvedIds.add(found.id);
    }
  }
  return merged;
}

import { db } from "./db";
import { users } from "@shared/schema";
import { asc } from "drizzle-orm";

export interface ResolvedUser {
  id: number;
  name: string;
  username: string;
  role: string;
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
  }).from(users).orderBy(asc(users.name));
  cachedUsers = rows;
  cacheTimestamp = Date.now();
  return cachedUsers;
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

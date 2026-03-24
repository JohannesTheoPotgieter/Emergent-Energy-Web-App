import { graphWithResilience } from "./tokenManager";

type PresenceRow = { availability: string; activity: string; fetchedAt: number };
const cache = new Map<string, PresenceRow>();
const TTL_MS = 2 * 60 * 1000;

export async function getPresenceCached(userId: string, accessToken: string) {
  const current = cache.get(userId);
  if (current && Date.now() - current.fetchedAt < TTL_MS) return current;
  const data = await graphWithResilience<any>(`/users/${encodeURIComponent(userId)}/presence`, accessToken);
  const normalized = { availability: data?.availability || "Unknown", activity: data?.activity || "Unknown", fetchedAt: Date.now() };
  cache.set(userId, normalized);
  return normalized;
}

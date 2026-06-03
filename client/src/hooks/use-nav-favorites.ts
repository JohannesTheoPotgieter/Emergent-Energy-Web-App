/**
 * Pinned favourites + recent destinations for the sidebar, persisted in
 * localStorage and shared across components via a small external store.
 *
 * - Pins: ordered list of paths the user starred.
 * - Recents: last few top-level pages visited (most-recent first, capped).
 */
import { useCallback, useSyncExternalStore } from "react";

const PIN_KEY = "ee_nav_pins";
const RECENT_KEY = "ee_nav_recents";
const RECENT_CAP = 6;

export interface RecentEntry {
  path: string;
  label: string;
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  emit();
}

// Cache the parsed snapshots so useSyncExternalStore gets a stable reference
// between renders (it bails out of re-render only when the snapshot is ===).
let pinsCache: string[] = readJSON<string[]>(PIN_KEY, []);
let recentsCache: RecentEntry[] = readJSON<RecentEntry[]>(RECENT_KEY, []);

function getPins(): string[] {
  return pinsCache;
}
function getRecents(): RecentEntry[] {
  return recentsCache;
}

export function useNavFavorites() {
  const pinned = useSyncExternalStore(subscribe, getPins, () => pinsCache);
  const recents = useSyncExternalStore(subscribe, getRecents, () => recentsCache);

  const togglePin = useCallback((path: string) => {
    pinsCache = pinsCache.includes(path)
      ? pinsCache.filter((p) => p !== path)
      : [...pinsCache, path];
    writeJSON(PIN_KEY, pinsCache);
  }, []);

  const recordVisit = useCallback((entry: RecentEntry) => {
    if (!entry.path || entry.path === "/") return;
    if (recentsCache[0]?.path === entry.path) return;
    recentsCache = [entry, ...recentsCache.filter((r) => r.path !== entry.path)].slice(0, RECENT_CAP);
    writeJSON(RECENT_KEY, recentsCache);
  }, []);

  const isPinned = useCallback((path: string) => pinned.includes(path), [pinned]);

  return { pinned, recents, togglePin, recordVisit, isPinned };
}

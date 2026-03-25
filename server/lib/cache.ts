/**
 * Cache service with Redis (preferred) or in-memory Map fallback.
 * Set REDIS_URL env var to enable Redis caching.
 */

import logger from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  clearPattern(pattern: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory LRU cache with TTL (fallback)
// ---------------------------------------------------------------------------

const MAX_MEMORY_ENTRIES = 1000;

interface MemoryEntry {
  value: string;
  expiresAt: number | null; // epoch ms, null = no expiry
}

class InMemoryCache implements CacheBackend {
  private store = new Map<string, MemoryEntry>();
  private accessOrder: string[] = []; // most-recently-used at the end

  private touch(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(key);
  }

  private evict(): void {
    while (this.store.size >= MAX_MEMORY_ENTRIES && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      if (oldest) this.store.delete(oldest);
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
      return null;
    }
    this.touch(key);
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.store.has(key)) this.evict();
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    this.touch(key);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
  }

  async clearPattern(pattern: string): Promise<void> {
    // Convert simple glob pattern (e.g. "dashboard:*") to regex
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const keysToDelete: string[] = [];
    for (const key of this.store.keys()) {
      if (regex.test(key)) keysToDelete.push(key);
    }
    for (const key of keysToDelete) {
      await this.del(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Redis cache backend
// ---------------------------------------------------------------------------

class RedisCacheBackend implements CacheBackend {
  private client: import("ioredis").default;

  constructor(client: import("ioredis").default) {
    this.client = client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clearPattern(pattern: string): Promise<void> {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== "0");
  }
}

// ---------------------------------------------------------------------------
// Singleton initialization
// ---------------------------------------------------------------------------

let backend: CacheBackend | null = null;
let redisClient: import("ioredis").default | null = null;
let _isRedis = false;

async function getBackend(): Promise<CacheBackend> {
  if (backend) return backend;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const Redis = (await import("ioredis")).default;
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        connectTimeout: 5000,
      });
      await client.connect();
      redisClient = client;
      backend = new RedisCacheBackend(client);
      _isRedis = true;
      logger.info("[cache] Redis cache backend active");
      return backend;
    } catch (err: any) {
      logger.warn(
        `[cache] Redis connection failed (${err.message}), falling back to in-memory cache`,
      );
    }
  }

  backend = new InMemoryCache();
  _isRedis = false;
  logger.info("[cache] In-memory cache backend active (set REDIS_URL for Redis)");
  return backend;
}

// Initialize eagerly on module load (non-blocking)
const backendReady = getBackend();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const b = await backendReady;
    const raw = await b.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  try {
    const b = await backendReady;
    await b.set(key, JSON.stringify(value), ttlSeconds);
  } catch {
    // Swallow errors — cache is best-effort
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const b = await backendReady;
    await b.del(key);
  } catch {
    // Swallow
  }
}

export async function cacheClear(pattern: string): Promise<void> {
  try {
    const b = await backendReady;
    await b.clearPattern(pattern);
  } catch {
    // Swallow
  }
}

/**
 * Returns true if the active cache backend is Redis.
 */
export function isRedisCache(): boolean {
  return _isRedis;
}

/**
 * Returns the underlying ioredis client, or null if Redis is not active.
 * Used by rate-limiter and job-queue for direct Redis access.
 */
export function getRedisClient(): import("ioredis").default | null {
  return redisClient;
}

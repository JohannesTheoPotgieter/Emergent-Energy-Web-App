/**
 * Job queue service with BullMQ (preferred) or in-memory fallback.
 * Requires REDIS_URL for BullMQ; otherwise uses a simple array-based queue.
 */

import logger from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobHandler = (data: unknown) => Promise<void>;

export interface EnqueueOptions {
  delay?: number;       // ms before the job becomes processable
  attempts?: number;    // max retries (default 3)
  jobId?: string;       // dedup key
}

export const QUEUE_NAMES = {
  METRICS_REFRESH: "metrics-refresh",
  NOTIFICATION_SEND: "notification-send",
  IMPORT_PROCESS: "import-process",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// In-memory fallback queue
// ---------------------------------------------------------------------------

interface MemoryJob {
  id: string;
  queueName: string;
  data: unknown;
  processAfter: number; // epoch ms
  attempts: number;
  maxAttempts: number;
}

const memoryQueues: MemoryJob[] = [];
const memoryWorkers = new Map<string, JobHandler>();
let memoryProcessorInterval: ReturnType<typeof setInterval> | null = null;

function startMemoryProcessor(): void {
  if (memoryProcessorInterval) return;
  memoryProcessorInterval = setInterval(async () => {
    const now = Date.now();
    const ready = memoryQueues.filter((j) => j.processAfter <= now);
    for (const job of ready) {
      const idx = memoryQueues.indexOf(job);
      if (idx !== -1) memoryQueues.splice(idx, 1);

      const handler = memoryWorkers.get(job.queueName);
      if (!handler) {
        // No worker registered yet — re-queue
        memoryQueues.push(job);
        continue;
      }

      try {
        await handler(job.data);
      } catch (err: unknown) {
        job.attempts++;
        if (job.attempts < job.maxAttempts) {
          job.processAfter = Date.now() + 1000 * job.attempts; // exponential-ish backoff
          memoryQueues.push(job);
        } else {
          logger.warn(
            `[job-queue:memory] Job ${job.id} in "${job.queueName}" failed after ${job.maxAttempts} attempts: ${(err instanceof Error ? err.message : String(err))}`,
          );
        }
      }
    }
  }, 1000);
}

let idCounter = 0;

function memoryEnqueue(
  queueName: string,
  data: unknown,
  opts?: EnqueueOptions,
): void {
  const jobId = opts?.jobId ?? `mem-${++idCounter}-${Date.now()}`;

  // Dedup: if a job with same id exists, skip
  if (opts?.jobId && memoryQueues.some((j) => j.id === jobId)) return;

  memoryQueues.push({
    id: jobId,
    queueName,
    data,
    processAfter: Date.now() + (opts?.delay ?? 0),
    attempts: 0,
    maxAttempts: opts?.attempts ?? 3,
  });

  startMemoryProcessor();
}

function memoryRegisterWorker(queueName: string, handler: JobHandler): void {
  memoryWorkers.set(queueName, handler);
  startMemoryProcessor();
}

// ---------------------------------------------------------------------------
// BullMQ backend
// ---------------------------------------------------------------------------

let bullQueues: Map<string, import("bullmq").Queue> | null = null;
let bullWorkers: Map<string, import("bullmq").Worker> | null = null;
let bullConnection: import("ioredis").default | null = null;
let _useBull = false;

async function initBull(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return false;

  try {
    const Redis = (await import("ioredis")).default;
    const conn = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // BullMQ requirement
      lazyConnect: true,
      connectTimeout: 5000,
    });
    await conn.connect();
    bullConnection = conn;
    bullQueues = new Map();
    bullWorkers = new Map();
    _useBull = true;
    logger.info("[job-queue] BullMQ backend active");
    return true;
  } catch (err: unknown) {
    logger.warn(
      `[job-queue] BullMQ init failed (${(err instanceof Error ? err.message : String(err))}), using in-memory queue`,
    );
    return false;
  }
}

function getBullQueue(queueName: string): import("bullmq").Queue {
  if (!bullQueues) throw new Error("BullMQ not initialized");
  let q = bullQueues.get(queueName);
  if (!q) {
    // Lazy-import already resolved at this point since initBull succeeded
    const { Queue } = require("bullmq") as typeof import("bullmq");
    q = new Queue(queueName, { connection: bullConnection! });
    bullQueues.set(queueName, q);
  }
  return q;
}

// ---------------------------------------------------------------------------
// Initialization (eager, non-blocking)
// ---------------------------------------------------------------------------

const initPromise = initBull().then((ok) => {
  if (!ok) {
    logger.info(
      "[job-queue] In-memory queue backend active (set REDIS_URL for BullMQ)",
    );
  }
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function enqueueJob(
  queueName: string,
  data: unknown,
  opts?: EnqueueOptions,
): Promise<void> {
  await initPromise;

  if (_useBull) {
    try {
      const q = getBullQueue(queueName);
      await q.add(queueName, data, {
        delay: opts?.delay,
        attempts: opts?.attempts ?? 3,
        jobId: opts?.jobId,
        backoff: { type: "exponential", delay: 1000 },
      });
      return;
    } catch (err: unknown) {
      logger.warn(
        `[job-queue] BullMQ enqueue failed (${(err instanceof Error ? err.message : String(err))}), falling back to memory`,
      );
    }
  }

  memoryEnqueue(queueName, data, opts);
}

export async function registerWorker(
  queueName: string,
  handler: JobHandler,
): Promise<void> {
  await initPromise;

  if (_useBull && bullConnection) {
    try {
      const { Worker } = await import("bullmq");
      const worker = new Worker(
        queueName,
        async (job) => {
          await handler(job.data);
        },
        {
          connection: bullConnection,
          concurrency: 5,
        },
      );
      worker.on("failed", (job, err) => {
        logger.warn(
          `[job-queue] Job ${job?.id} in "${queueName}" failed: ${(err instanceof Error ? err.message : String(err))}`,
        );
      });
      if (!bullWorkers) bullWorkers = new Map();
      bullWorkers.set(queueName, worker);
      return;
    } catch (err: unknown) {
      logger.warn(
        `[job-queue] BullMQ worker registration failed (${(err instanceof Error ? err.message : String(err))}), using memory worker`,
      );
    }
  }

  memoryRegisterWorker(queueName, handler);
}

/**
 * Returns true if the active queue backend is BullMQ.
 */
export function isBullMQActive(): boolean {
  return _useBull;
}

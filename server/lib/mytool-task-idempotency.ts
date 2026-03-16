export type IdempotencyStatus = "pending" | "completed";

type RecordEntry = {
  key: string;
  userId: number;
  status: IdempotencyStatus;
  taskId?: number;
  createdAtMs: number;
  updatedAtMs: number;
};

const DEFAULT_WINDOW_MS = 2 * 60 * 1000;

export class MytoolTaskIdempotencyStore {
  private records = new Map<string, RecordEntry>();

  constructor(private readonly windowMs: number = DEFAULT_WINDOW_MS) {}

  private scopedKey(userId: number, key: string): string {
    return `${userId}:${key}`;
  }

  private isExpired(entry: RecordEntry, nowMs: number): boolean {
    return nowMs - entry.updatedAtMs > this.windowMs;
  }

  private getEntry(userId: number, key: string, nowMs: number): RecordEntry | null {
    const scoped = this.scopedKey(userId, key);
    const entry = this.records.get(scoped);
    if (!entry) return null;
    if (this.isExpired(entry, nowMs)) {
      this.records.delete(scoped);
      return null;
    }
    return entry;
  }

  begin(userId: number, key: string, nowMs: number = Date.now()): { state: "started" | "duplicate_pending" | "duplicate_completed"; taskId?: number } {
    const existing = this.getEntry(userId, key, nowMs);
    if (!existing) {
      this.records.set(this.scopedKey(userId, key), {
        key,
        userId,
        status: "pending",
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      });
      return { state: "started" };
    }

    existing.updatedAtMs = nowMs;
    if (existing.status === "completed" && existing.taskId) {
      return { state: "duplicate_completed", taskId: existing.taskId };
    }

    return { state: "duplicate_pending" };
  }

  complete(userId: number, key: string, taskId: number, nowMs: number = Date.now()): void {
    this.records.set(this.scopedKey(userId, key), {
      key,
      userId,
      status: "completed",
      taskId,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  fail(userId: number, key: string): void {
    this.records.delete(this.scopedKey(userId, key));
  }
}

export const mytoolTaskIdempotencyStore = new MytoolTaskIdempotencyStore();

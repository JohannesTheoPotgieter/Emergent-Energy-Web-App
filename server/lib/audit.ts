import { db } from "../db";
import { auditEvents } from "@shared/schema";

interface PersistentAuditEvent {
  action: string;
  username: string;
  userId?: number | null;
  entityType?: string;
  entityId?: string | null;
  source?: "UI" | "IMPORT" | "SETTINGS" | "DOCS" | "SYSTEM";
  changesJson?: Record<string, unknown> | null;
}

class AuditLogger {
  async log(event: PersistentAuditEvent): Promise<void> {
    await db.insert(auditEvents).values({
      action: event.action,
      userName: event.username,
      userId: event.userId ?? null,
      actorRole: "system",
      entityType: event.entityType ?? "system",
      entityId: event.entityId ?? null,
      source: event.source ?? "SYSTEM",
      changesJson: event.changesJson ?? null,
    });
  }

  async getLogs(limit = 100) {
    const rows = await db.select().from(auditEvents).limit(limit);
    return rows;
  }
}

export default new AuditLogger();

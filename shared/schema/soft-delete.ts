import { isNull } from "drizzle-orm";

export type SoftDeleteTable = {
  deletedAt: unknown;
};

export const notDeleted = <T extends SoftDeleteTable>(table: T) => isNull(table.deletedAt as any);

import { db } from "../db";
import { msAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { encrypt, isEncryptedPayload } from "../utils/encryption";

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await db.select().from(msAccounts);

  let touched = 0;
  for (const row of rows) {
    const updates: Record<string, string> = {};

    if (row.ssoAccessToken && !isEncryptedPayload(row.ssoAccessToken)) {
      updates.ssoAccessToken = encrypt(row.ssoAccessToken);
    }

    if (row.refreshTokenEncrypted && !isEncryptedPayload(row.refreshTokenEncrypted)) {
      updates.refreshTokenEncrypted = encrypt(row.refreshTokenEncrypted);
    }

    if (Object.keys(updates).length === 0) continue;
    touched += 1;

    if (!dryRun) {
      await db.update(msAccounts).set(updates).where(eq(msAccounts.id, row.id));
    }
  }

  console.log(`[encrypt-existing-tokens] ${dryRun ? "dry-run" : "updated"}: ${touched} account(s)`);
}

run().catch((err) => {
  console.error("[encrypt-existing-tokens] failed:", err);
  process.exit(1);
});
